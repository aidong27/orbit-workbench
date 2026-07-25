[CmdletBinding()]
param(
  [string]$ReleaseDirectory = "release",
  [string]$ExpectedVersion = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$releasePath = [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot $ReleaseDirectory))
$diagnosticsPath = Join-Path $releasePath "windows-diagnostics"
New-Item -ItemType Directory -Path $diagnosticsPath -Force | Out-Null

if ([string]::IsNullOrWhiteSpace($ExpectedVersion)) {
  $packageJson = Get-Content (Join-Path $repositoryRoot "package.json") -Raw | ConvertFrom-Json
  $ExpectedVersion = [string]$packageJson.version
}

if ($ExpectedVersion -notmatch "^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$") {
  throw "ExpectedVersion is not a supported semantic version: $ExpectedVersion"
}

$baseVersion = $ExpectedVersion.Split("-", 2)[0]
$expectedProductName = "星轨工作台"
$expectedExecutableName = "Orbit Workbench.exe"
$expectedInstallerName = "Orbit-Workbench-$ExpectedVersion-Windows-x64-Setup.exe"
$expectedPortableName = "Orbit-Workbench-$ExpectedVersion-Windows-x64-Portable.exe"
$expectedProductVersion = "$baseVersion.0"
$expectedJobRunnerHash = "eef8c5061b96a5ba76c3fd980c718761a7d269cc13def4fe23006df358054443"
$verificationLog = Join-Path $diagnosticsPath "verification.log"
$summaryPath = Join-Path $diagnosticsPath "summary.txt"
$transcriptStarted = $false
$failure = $null
$userDataSentinel = $null
$verificationRoot = $null
$installDirectory = $null
$installedApp = $null
$renamedPortable = $null
$desktopShortcut = $null
$startMenuShortcut = $null
$taskkillPath = $null
$runnerTemp = if ([string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) {
  [System.IO.Path]::GetTempPath()
} else {
  [System.IO.Path]::GetFullPath($env:RUNNER_TEMP)
}
$baselineProcessIds = [System.Collections.Generic.HashSet[int]]::new()
Get-Process -ErrorAction SilentlyContinue | ForEach-Object {
  [void]$baselineProcessIds.Add($_.Id)
}

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) {
    throw $Message
  }
}

function Assert-NonEmptyFile([string]$Path, [string]$Description) {
  Assert-True (Test-Path -LiteralPath $Path -PathType Leaf) "$Description is missing: $Path"
  $item = Get-Item -LiteralPath $Path
  Assert-True ($item.Length -gt 0) "$Description is empty: $Path"
}

function Get-OptionalPropertyValue([object]$InputObject, [string]$Name) {
  if ($null -eq $InputObject) {
    return $null
  }
  $property = $InputObject.PSObject.Properties[$Name]
  if ($null -eq $property) {
    return $null
  }
  return $property.Value
}

function Get-PeMachine([string]$Path) {
  Assert-NonEmptyFile $Path "PE image"
  $stream = [System.IO.File]::Open(
    $Path,
    [System.IO.FileMode]::Open,
    [System.IO.FileAccess]::Read,
    [System.IO.FileShare]::Read
  )
  $reader = [System.IO.BinaryReader]::new($stream)
  try {
    Assert-True ($stream.Length -ge 70) "PE image is too short: $Path"
    Assert-True ($reader.ReadUInt16() -eq 0x5A4D) "PE image has no DOS header: $Path"
    [void]$stream.Seek(0x3C, [System.IO.SeekOrigin]::Begin)
    $peOffset = $reader.ReadInt32()
    Assert-True (
      $peOffset -gt 0 -and $peOffset -le ($stream.Length - 6)
    ) "PE image has an invalid header offset: $Path"
    [void]$stream.Seek($peOffset, [System.IO.SeekOrigin]::Begin)
    Assert-True ($reader.ReadUInt32() -eq 0x00004550) "PE signature is invalid: $Path"
    return $reader.ReadUInt16()
  } finally {
    $reader.Dispose()
    $stream.Dispose()
  }
}

function Get-SystemTaskkillPath {
  $systemRoot = [System.Environment]::GetEnvironmentVariable(
    "SystemRoot",
    [System.EnvironmentVariableTarget]::Machine
  )
  if ([string]::IsNullOrWhiteSpace($systemRoot)) {
    $systemRoot = $env:SystemRoot
  }
  Assert-True (-not [string]::IsNullOrWhiteSpace($systemRoot)) (
    "Windows SystemRoot could not be resolved."
  )
  $resolved = Join-Path ([System.IO.Path]::GetFullPath($systemRoot)) "System32/taskkill.exe"
  Assert-NonEmptyFile $resolved "System taskkill"
  return $resolved
}

function Get-ProductProcesses([string[]]$KnownExecutablePaths = @()) {
  $normalizedPaths = @(
    foreach ($path in $KnownExecutablePaths) {
      if (-not [string]::IsNullOrWhiteSpace($path)) {
        [System.IO.Path]::GetFullPath($path)
      }
    }
  )
  @(
    Get-Process -ErrorAction SilentlyContinue | Where-Object {
      if ($baselineProcessIds.Contains($_.Id)) {
        return $false
      }
      if ($_.ProcessName -eq "Orbit Workbench") {
        return $true
      }
      try {
        $processPath = $_.Path
        if ([string]::IsNullOrWhiteSpace($processPath)) {
          return $false
        }
        foreach ($knownPath in $normalizedPaths) {
          if (
            $processPath.Equals(
              $knownPath,
              [System.StringComparison]::OrdinalIgnoreCase
            )
          ) {
            return $true
          }
        }
      } catch {
        return $false
      }
      return $false
    }
  )
}

function Stop-ProcessTree([int]$ProcessId) {
  if ($baselineProcessIds.Contains($ProcessId)) {
    throw "Refusing to terminate baseline process PID $ProcessId."
  }
  Assert-NonEmptyFile $taskkillPath "System taskkill"
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    # A process can exit between the liveness check and taskkill. Do not let
    # that harmless race replace the original verification failure.
    $ErrorActionPreference = "Continue"
    & $taskkillPath /PID $ProcessId /T /F *> $null
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  $terminationDeadline = (Get-Date).AddSeconds(5)
  while (
    (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) -and
    (Get-Date) -lt $terminationDeadline
  ) {
    Start-Sleep -Milliseconds 100
  }
  if (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) {
    throw "System taskkill could not terminate PID $ProcessId."
  }
}

function Wait-ProcessTree(
  [System.Diagnostics.Process]$Process,
  [string]$Label,
  [int]$TimeoutSeconds
) {
  $trackedProcessIds = [System.Collections.Generic.HashSet[int]]::new()
  [void]$trackedProcessIds.Add($Process.Id)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $liveTrackedIds = @($Process.Id)

  do {
    $processSnapshot = @(
      Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Select-Object ProcessId, ParentProcessId
    )
    $foundDescendant = $true
    while ($foundDescendant) {
      $foundDescendant = $false
      foreach ($candidate in $processSnapshot) {
        $candidateId = [int]$candidate.ProcessId
        if (
          $trackedProcessIds.Contains([int]$candidate.ParentProcessId) -and
          -not $trackedProcessIds.Contains($candidateId)
        ) {
          [void]$trackedProcessIds.Add($candidateId)
          $foundDescendant = $true
        }
      }
    }

    $liveProcessIds = [System.Collections.Generic.HashSet[int]]::new()
    foreach ($candidate in $processSnapshot) {
      [void]$liveProcessIds.Add([int]$candidate.ProcessId)
    }
    $liveTrackedIds = @(
      foreach ($trackedId in $trackedProcessIds) {
        if ($liveProcessIds.Contains($trackedId)) {
          $trackedId
        }
      }
    )
    if ($liveTrackedIds.Count -eq 0) {
      break
    }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)

  if ($liveTrackedIds.Count -gt 0) {
    foreach ($trackedId in $liveTrackedIds) {
      if (-not $baselineProcessIds.Contains($trackedId)) {
        Stop-ProcessTree $trackedId
      }
    }
    throw "$Label process tree did not exit within $TimeoutSeconds seconds."
  }

  $Process.Refresh()
  Assert-True ($Process.HasExited) "$Label launcher did not report an exit."
  Assert-True ($Process.ExitCode -eq 0) "$Label failed with exit code $($Process.ExitCode)."
}

function Assert-NoProductProcesses(
  [string]$Context,
  [string[]]$KnownExecutablePaths = @()
) {
  $deadline = (Get-Date).AddSeconds(15)
  do {
    $remaining = @(Get-ProductProcesses $KnownExecutablePaths)
    if ($remaining.Count -eq 0) {
      return
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)

  $remaining |
    Select-Object Id, ProcessName, Path, StartTime |
    Format-List |
    Out-String |
    Set-Content (Join-Path $diagnosticsPath "remaining-processes.txt") -Encoding utf8NoBOM
  foreach ($process in $remaining) {
    Stop-ProcessTree $process.Id
  }
  throw "$Context left one or more Orbit Workbench processes running."
}

function Invoke-VerifiedProcess(
  [string]$Executable,
  [string[]]$Arguments,
  [string]$Label,
  [int]$TimeoutSeconds = 45
) {
  Assert-NonEmptyFile $Executable "$Label executable"
  $safeLabel = $Label -replace "[^0-9A-Za-z_-]", "-"
  $stdoutPath = Join-Path $diagnosticsPath "$safeLabel.stdout.log"
  $stderrPath = Join-Path $diagnosticsPath "$safeLabel.stderr.log"
  Write-Host "Launching $Label`: $Executable $($Arguments -join ' ')"
  $process = Start-Process `
    -FilePath $Executable `
    -ArgumentList $Arguments `
    -PassThru `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath

  try {
    Wait-ProcessTree $process $Label $TimeoutSeconds
  } catch {
    if (-not $process.HasExited) {
      Stop-ProcessTree $process.Id
    }
    throw
  }
}

function Invoke-SmokeTest(
  [string]$Executable,
  [string]$Label,
  [string[]]$AdditionalArguments = @()
) {
  $arguments = @("--smoke-test", "--disable-gpu") + $AdditionalArguments
  Invoke-VerifiedProcess $Executable $arguments $Label 45
  Assert-NoProductProcesses "$Label smoke test" @($Executable)
}

function Assert-ApplicationPayload([string]$ApplicationDirectory, [string]$Label) {
  $applicationExecutable = Join-Path $ApplicationDirectory $expectedExecutableName
  Assert-NonEmptyFile $applicationExecutable "$Label application"
  $peMachine = Get-PeMachine $applicationExecutable
  Assert-True ($peMachine -eq 0x8664) (
    "$Label application is not an x64 PE image (machine 0x{0:X4})." -f $peMachine
  )

  $requiredResources = @(
    "LICENSE.txt",
    "THIRD_PARTY_NOTICES.md",
    "THIRD_PARTY_LICENSES.txt",
    "THIRD_PARTY_LICENSES.chromium.html",
    "windows-job-runner.exe",
    "app.asar"
  )
  foreach ($resource in $requiredResources) {
    Assert-NonEmptyFile (Join-Path $ApplicationDirectory "resources/$resource") "$Label $resource"
  }
  $jobRunner = Join-Path $ApplicationDirectory "resources/windows-job-runner.exe"
  $jobRunnerMachine = Get-PeMachine $jobRunner
  Assert-True ($jobRunnerMachine -eq 0x8664) (
    "$Label Windows Job Object runner is not x64 (machine 0x{0:X4})." -f $jobRunnerMachine
  )
  $jobRunnerHash = (
    Get-FileHash -LiteralPath $jobRunner -Algorithm SHA256
  ).Hash.ToLowerInvariant()
  Assert-True ($jobRunnerHash -eq $expectedJobRunnerHash) (
    "$Label Windows Job Object runner hash does not match the reviewed binary."
  )

  $versionInfo = (Get-Item -LiteralPath $applicationExecutable).VersionInfo
  Assert-True (
    -not [string]::IsNullOrWhiteSpace($versionInfo.ProductVersion)
  ) "$Label application has no ProductVersion."
  Assert-True (
    $versionInfo.ProductVersion -eq $expectedProductVersion
  ) "$Label ProductVersion '$($versionInfo.ProductVersion)' does not match '$expectedProductVersion'."
  Assert-True (
    $versionInfo.FileVersion -eq $ExpectedVersion
  ) "$Label FileVersion '$($versionInfo.FileVersion)' does not match '$ExpectedVersion'."
  Assert-True (
    $versionInfo.ProductName -eq $expectedProductName
  ) "$Label ProductName '$($versionInfo.ProductName)' does not match '$expectedProductName'."
  Assert-True (
    $versionInfo.FileDescription -eq $expectedProductName
  ) "$Label FileDescription '$($versionInfo.FileDescription)' does not match '$expectedProductName'."

  return $applicationExecutable
}

function Get-UninstallEntries {
  $registryPaths = @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
  )
  @(
    foreach ($registryPath in $registryPaths) {
      Get-ItemProperty $registryPath -ErrorAction SilentlyContinue |
        Where-Object {
          (Get-OptionalPropertyValue $_ "DisplayName") -eq $expectedProductName
        }
    }
  )
}

function Get-UninstallEntriesForInstall([string]$InstallDirectory) {
  $normalizedExpected = [System.IO.Path]::GetFullPath($InstallDirectory).TrimEnd("\", "/")
  @(
    Get-UninstallEntries | Where-Object {
      $installLocation = [string](Get-OptionalPropertyValue $_ "InstallLocation")
      if ([string]::IsNullOrWhiteSpace($installLocation)) {
        return $false
      }
      try {
        $normalizedActual = [System.IO.Path]::GetFullPath($installLocation).TrimEnd("\", "/")
        return $normalizedActual.Equals(
          $normalizedExpected,
          [System.StringComparison]::OrdinalIgnoreCase
        )
      } catch {
        return $false
      }
    }
  )
}

function Get-UninstallKeyPaths {
  @(
    Get-UninstallEntries |
      ForEach-Object {
        $keyPath = [string](Get-OptionalPropertyValue $_ "PSPath")
        if (-not [string]::IsNullOrWhiteSpace($keyPath)) {
          $keyPath.ToLowerInvariant()
        }
      }
  ) | Sort-Object -Unique
}

function Get-CommandExecutable([string]$CommandLine) {
  if ($CommandLine -match '^\s*"([^"]+)"(?:\s|$)') {
    return $Matches[1]
  }
  if ($CommandLine -match '^\s*(.+?\.exe)(?:\s|$)') {
    return $Matches[1]
  }
  return ""
}

function Assert-RegisteredUninstallerCommand(
  [string]$CommandLine,
  [string]$ExpectedExecutable,
  [bool]$RequireSilent,
  [string]$Description
) {
  $registeredExecutable = Get-CommandExecutable $CommandLine
  Assert-True (
    -not [string]::IsNullOrWhiteSpace($registeredExecutable) -and
    [System.IO.Path]::GetFullPath($registeredExecutable).Equals(
      [System.IO.Path]::GetFullPath($ExpectedExecutable),
      [System.StringComparison]::OrdinalIgnoreCase
    )
  ) "$Description does not exactly target the tested uninstaller."
  Assert-True (
    $CommandLine -match "(?i)(?:^|\s)/currentuser(?:\s|$)"
  ) "$Description does not retain the current-user installation mode."
  if ($RequireSilent) {
    Assert-True (
      $CommandLine -match "(?i)(?:^|\s)/S(?:\s|$)"
    ) "$Description is not registered as a silent uninstall command."
  }
}

function Assert-Shortcut([string]$ShortcutPath, [string]$ExpectedTarget, [string]$Description) {
  Assert-NonEmptyFile $ShortcutPath $Description
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($ShortcutPath)
  $target = $shortcut.TargetPath
  $normalizedTarget = [System.IO.Path]::GetFullPath($target)
  $normalizedExpected = [System.IO.Path]::GetFullPath($ExpectedTarget)
  Assert-True (
    $normalizedTarget.Equals($normalizedExpected, [System.StringComparison]::OrdinalIgnoreCase)
  ) "$Description target '$target' does not match '$ExpectedTarget'."
  Assert-True ([string]::IsNullOrWhiteSpace([string]$shortcut.Arguments)) (
    "$Description unexpectedly adds launch arguments: $($shortcut.Arguments)"
  )
  return $ShortcutPath
}

function Get-ShortcutPaths([string[]]$SearchRoots) {
  @(
    foreach ($searchRoot in $SearchRoots) {
      if (Test-Path -LiteralPath $searchRoot -PathType Container) {
        Get-ChildItem -LiteralPath $searchRoot -Filter "*.lnk" -File -Recurse |
          ForEach-Object { $_.FullName.ToLowerInvariant() }
      }
    }
  ) | Sort-Object -Unique
}

function Get-SmokeReportedUserDataPath([string]$StdoutPath) {
  Assert-True (Test-Path -LiteralPath $StdoutPath -PathType Leaf) (
    "Installed app smoke stdout is missing: $StdoutPath"
  )
  $prefix = "ORBIT_SMOKE_USER_DATA_BASE64:"
  $matches = @(
    Get-Content -LiteralPath $StdoutPath |
      Where-Object { $_.StartsWith($prefix, [System.StringComparison]::Ordinal) }
  )
  Assert-True ($matches.Count -eq 1) (
    "Expected exactly one userData report in smoke stdout, found $($matches.Count)."
  )
  $encodedPath = $matches[0].Substring($prefix.Length)
  Assert-True (
    -not [string]::IsNullOrWhiteSpace($encodedPath) -and
    $encodedPath.Length % 4 -eq 0 -and
    $encodedPath -match "^[A-Za-z0-9+/]+={0,2}$"
  ) "Installed app reported malformed Base64 userData data."
  try {
    $pathBytes = [Convert]::FromBase64String($encodedPath)
    $strictUtf8 = [System.Text.UTF8Encoding]::new($false, $true)
    return $strictUtf8.GetString($pathBytes)
  } catch {
    throw "Installed app userData report is not valid Base64-encoded UTF-8."
  }
}

function Remove-TestShortcut([string]$ShortcutPath) {
  if (
    [string]::IsNullOrWhiteSpace($ShortcutPath) -or
    -not (Test-Path -LiteralPath $ShortcutPath -PathType Leaf)
  ) {
    return
  }
  $expectedTestApp = Join-Path $installDirectory $expectedExecutableName
  $shell = New-Object -ComObject WScript.Shell
  $shortcutTarget = $shell.CreateShortcut($ShortcutPath).TargetPath
  $isTestShortcut = (
    -not [string]::IsNullOrWhiteSpace([string]$shortcutTarget) -and
    [System.IO.Path]::GetFullPath($shortcutTarget).Equals(
      [System.IO.Path]::GetFullPath($expectedTestApp),
      [System.StringComparison]::OrdinalIgnoreCase
    )
  )
  if (-not $isTestShortcut) {
    Write-Warning "Refusing to remove a shortcut that no longer targets the test install: $ShortcutPath"
    return
  }
  Remove-Item -LiteralPath $ShortcutPath -Force
}

function Remove-TestInstallation {
  if ([string]::IsNullOrWhiteSpace([string]$installDirectory)) {
    return
  }

  $knownTestExecutables = @($installedApp, $renamedPortable) |
    Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }
  foreach ($process in @(Get-ProductProcesses $knownTestExecutables)) {
    try {
      Stop-ProcessTree $process.Id
    } catch {
      Write-Warning "Could not terminate test process PID $($process.Id): $($_.Exception.Message)"
    }
  }

  $emergencyUninstallers = @()
  if (Test-Path -LiteralPath $installDirectory -PathType Container) {
    $emergencyUninstallers = @(
      Get-ChildItem -LiteralPath $installDirectory -Filter "Uninstall*.exe" -File
    )
  }
  if ($emergencyUninstallers.Count -eq 1) {
    try {
      Invoke-VerifiedProcess $emergencyUninstallers[0].FullName (
        @("/currentuser", "/S")
      ) "emergency-nsis-uninstaller" 90
    } catch {
      Write-Warning "Emergency NSIS uninstall did not complete: $($_.Exception.Message)"
    }
  }

  foreach ($shortcutPath in @($desktopShortcut, $startMenuShortcut)) {
    try {
      Remove-TestShortcut $shortcutPath
    } catch {
      Write-Warning "Could not remove the exact test shortcut '$shortcutPath': $($_.Exception.Message)"
    }
  }

  foreach ($entry in @(Get-UninstallEntriesForInstall $installDirectory)) {
    $entryKeyPath = [string](Get-OptionalPropertyValue $entry "PSPath")
    if (-not [string]::IsNullOrWhiteSpace($entryKeyPath)) {
      try {
        Remove-Item -LiteralPath $entryKeyPath -Recurse -Force
      } catch {
        Write-Warning "Could not remove the exact test uninstall key: $($_.Exception.Message)"
      }
    }
  }
}

function Write-Diagnostics {
  @(
    "TimestampUtc: $([DateTime]::UtcNow.ToString('O'))"
    "OS: $([System.Environment]::OSVersion.VersionString)"
    "PowerShell: $($PSVersionTable.PSVersion)"
    "ProcessArchitecture: $([System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture)"
    "RunnerTemp: $runnerTemp"
    "ReleasePath: $releasePath"
    "ExpectedVersion: $ExpectedVersion"
    "BaselineProcessCount: $($baselineProcessIds.Count)"
    "BaselineProcessIds: $((@($baselineProcessIds) | Sort-Object) -join ',')"
    "Node: $(& node.exe --version)"
    "pnpm: $(& pnpm.cmd --version)"
  ) | Set-Content (Join-Path $diagnosticsPath "environment.txt") -Encoding utf8NoBOM

  Get-ChildItem -LiteralPath $releasePath -Recurse |
    Select-Object FullName, Length, LastWriteTime |
    Format-Table -AutoSize |
    Out-String -Width 4096 |
    Set-Content (Join-Path $diagnosticsPath "release-files.txt") -Encoding utf8NoBOM

  Get-Process |
    Where-Object { $_.ProcessName -match "Orbit|星轨" } |
    Select-Object Id, ProcessName, Path, StartTime |
    Format-List |
    Out-String |
    Set-Content (Join-Path $diagnosticsPath "matching-processes.txt") -Encoding utf8NoBOM

  Get-UninstallEntries |
    Select-Object DisplayName, DisplayVersion, InstallLocation, UninstallString, PSPath |
    Format-List |
    Out-String |
    Set-Content (Join-Path $diagnosticsPath "uninstall-registry.txt") -Encoding utf8NoBOM
}

try {
  Start-Transcript -Path $verificationLog -Force | Out-Null
  $transcriptStarted = $true
  $taskkillPath = Get-SystemTaskkillPath

  Write-Step "Verify exact Windows artifact names"
  Assert-True (Test-Path -LiteralPath $releasePath -PathType Container) "Release directory is missing."
  $installerPath = Join-Path $releasePath $expectedInstallerName
  $portablePath = Join-Path $releasePath $expectedPortableName
  Assert-NonEmptyFile $installerPath "NSIS installer"
  Assert-NonEmptyFile $portablePath "Portable artifact"

  $rootExecutables = @(Get-ChildItem -LiteralPath $releasePath -Filter "*.exe" -File)
  Assert-True ($rootExecutables.Count -eq 2) (
    "Expected exactly two root Windows artifacts, found $($rootExecutables.Count): " +
    (($rootExecutables.Name | Sort-Object) -join ", ")
  )
  Assert-True (
    ($rootExecutables.Name -contains $expectedInstallerName) -and
    ($rootExecutables.Name -contains $expectedPortableName)
  ) "Windows artifact names do not match package version and architecture."

  Write-Step "Refuse to overwrite an existing installation or shortcut"
  $desktopDirectory = [System.Environment]::GetFolderPath(
    [System.Environment+SpecialFolder]::Desktop
  )
  $programsDirectory = [System.Environment]::GetFolderPath(
    [System.Environment+SpecialFolder]::Programs
  )
  Assert-True (-not [string]::IsNullOrWhiteSpace($desktopDirectory)) (
    "Current-user Desktop directory could not be resolved."
  )
  Assert-True (-not [string]::IsNullOrWhiteSpace($programsDirectory)) (
    "Current-user Start menu Programs directory could not be resolved."
  )
  $expectedDesktopShortcut = Join-Path $desktopDirectory "$expectedProductName.lnk"
  $expectedStartMenuShortcut = Join-Path $programsDirectory "$expectedProductName.lnk"
  $desktopShortcut = $expectedDesktopShortcut
  $startMenuShortcut = $expectedStartMenuShortcut
  $preexistingUninstallEntries = @(Get-UninstallEntries)
  Assert-True ($preexistingUninstallEntries.Count -eq 0) (
    "Refusing to run destructive package verification while an existing " +
    "'$expectedProductName' installation is registered."
  )
  Assert-True (-not (Test-Path -LiteralPath $expectedDesktopShortcut)) (
    "Refusing to overwrite an existing desktop shortcut: $expectedDesktopShortcut"
  )
  Assert-True (-not (Test-Path -LiteralPath $expectedStartMenuShortcut)) (
    "Refusing to overwrite an existing Start menu shortcut: $expectedStartMenuShortcut"
  )

  Write-Step "Verify unpacked application payload and launch"
  $unpackedDirectory = Join-Path $releasePath "win-unpacked"
  $unpackedApp = Assert-ApplicationPayload $unpackedDirectory "Unpacked"
  Invoke-SmokeTest $unpackedApp "unpacked-app"

  Write-Step "Install NSIS package into a path containing spaces and Chinese"
  $verificationRoot = Join-Path $runnerTemp "Orbit Workbench CI-$([Guid]::NewGuid().ToString('N'))"
  $installDirectory = Join-Path $verificationRoot "中文 安装目录"
  Assert-True (-not (Test-Path -LiteralPath $verificationRoot)) (
    "Unique verification root unexpectedly exists: $verificationRoot"
  )
  # NSIS requires the unquoted /D= value to be the final command-line parameter.
  # It consumes the remainder of the command line, including spaces and Unicode characters.
  $installerArguments = @("/S", "/D=$installDirectory")
  Assert-True ($installerArguments[-1] -eq "/D=$installDirectory") (
    "NSIS custom installation directory is not the final parameter."
  )
  Assert-True (@(Get-UninstallEntriesForInstall $installDirectory).Count -eq 0) (
    "The test installation directory already has an uninstall entry."
  )
  Invoke-VerifiedProcess $installerPath $installerArguments "nsis-installer" 90
  $installedApp = Assert-ApplicationPayload $installDirectory "Installed"
  Invoke-SmokeTest $installedApp "installed-app" @("--smoke-report-user-data")
  $installedSmokeStdout = Join-Path $diagnosticsPath "installed-app.stdout.log"
  $reportedUserDataPath = Get-SmokeReportedUserDataPath $installedSmokeStdout
  Assert-True ([System.IO.Path]::IsPathFullyQualified($reportedUserDataPath)) (
    "Installed app reported a non-absolute userData path."
  )
  $roamingAppData = [System.IO.Path]::GetFullPath(
    [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::ApplicationData)
  ).TrimEnd("\", "/")
  $normalizedUserDataPath = [System.IO.Path]::GetFullPath($reportedUserDataPath).TrimEnd("\", "/")
  Assert-True (
    $normalizedUserDataPath.StartsWith(
      "$roamingAppData$([System.IO.Path]::DirectorySeparatorChar)",
      [System.StringComparison]::OrdinalIgnoreCase
    )
  ) "Installed app userData path is outside the current user's roaming AppData directory."
  New-Item -ItemType Directory -Path $normalizedUserDataPath -Force | Out-Null
  $userDataSentinel = Join-Path $normalizedUserDataPath ".orbit-uninstall-preserve-$([Guid]::NewGuid()).txt"
  "preserve" | Set-Content -LiteralPath $userDataSentinel -Encoding utf8NoBOM

  Write-Step "Verify uninstall registration and shortcuts"
  $uninstallEntries = @(Get-UninstallEntriesForInstall $installDirectory)
  Assert-True ($uninstallEntries.Count -eq 1) (
    "Expected one uninstall entry for '$installDirectory', found $($uninstallEntries.Count)."
  )
  $uninstallEntry = $uninstallEntries[0]
  $uninstallDisplayVersion = [string](Get-OptionalPropertyValue $uninstallEntry "DisplayVersion")
  $uninstallKeyPath = [string](Get-OptionalPropertyValue $uninstallEntry "PSPath")
  $uninstallDisplayIcon = [string](Get-OptionalPropertyValue $uninstallEntry "DisplayIcon")
  $registeredUninstallCommand = [string](
    Get-OptionalPropertyValue $uninstallEntry "UninstallString"
  )
  $registeredQuietUninstallCommand = [string](
    Get-OptionalPropertyValue $uninstallEntry "QuietUninstallString"
  )
  Assert-True (
    $uninstallDisplayVersion -eq $ExpectedVersion
  ) "Uninstall DisplayVersion '$uninstallDisplayVersion' does not match '$ExpectedVersion'."
  Assert-True (
    -not [string]::IsNullOrWhiteSpace($uninstallKeyPath)
  ) "Uninstall registry key path is missing."
  $expectedDisplayIcon = Join-Path $installDirectory "uninstallerIcon.ico"
  Assert-NonEmptyFile $expectedDisplayIcon "Installed uninstaller display icon"
  Assert-True (
    -not [string]::IsNullOrWhiteSpace($uninstallDisplayIcon)
  ) "Uninstall DisplayIcon is missing."
  Assert-True (
    [System.IO.Path]::GetFullPath($uninstallDisplayIcon).Equals(
      [System.IO.Path]::GetFullPath($expectedDisplayIcon),
      [System.StringComparison]::OrdinalIgnoreCase
    )
  ) "Uninstall DisplayIcon does not target the installed project icon."

  $uninstaller = @(
    Get-ChildItem -LiteralPath $installDirectory -Filter "Uninstall*.exe" -File
  )
  Assert-True ($uninstaller.Count -eq 1) "Expected exactly one NSIS uninstaller."
  Assert-RegisteredUninstallerCommand (
    $registeredUninstallCommand
  ) $uninstaller[0].FullName $false "UninstallString"
  Assert-RegisteredUninstallerCommand (
    $registeredQuietUninstallCommand
  ) $uninstaller[0].FullName $true "QuietUninstallString"

  Assert-Shortcut $expectedDesktopShortcut $installedApp "Desktop shortcut" | Out-Null
  Assert-Shortcut $expectedStartMenuShortcut $installedApp "Start menu shortcut" | Out-Null

  Write-Step "Run the uninstaller and verify cleanup"
  Invoke-VerifiedProcess $uninstaller[0].FullName @("/currentuser", "/S") "nsis-uninstaller" 90

  $cleanupDeadline = (Get-Date).AddSeconds(30)
  do {
    $installDirectoryStillExists = Test-Path -LiteralPath $installDirectory
    $registryStillExists = Test-Path -LiteralPath $uninstallKeyPath
    $desktopShortcutStillExists = Test-Path -LiteralPath $desktopShortcut
    $startMenuShortcutStillExists = Test-Path -LiteralPath $startMenuShortcut
    if (
      -not $installDirectoryStillExists -and
      -not $registryStillExists -and
      -not $desktopShortcutStillExists -and
      -not $startMenuShortcutStillExists
    ) {
      break
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $cleanupDeadline)

  Assert-True (-not (Test-Path -LiteralPath $installDirectory)) (
    "Uninstall left the installation directory or payload behind: $installDirectory"
  )
  Assert-True (-not (Test-Path -LiteralPath $uninstallKeyPath)) (
    "Tested uninstall registry key remains after uninstall: $uninstallKeyPath"
  )
  Assert-True (-not (Test-Path -LiteralPath $desktopShortcut)) (
    "Desktop shortcut remains after uninstall: $desktopShortcut"
  )
  Assert-True (-not (Test-Path -LiteralPath $startMenuShortcut)) (
    "Start menu shortcut remains after uninstall: $startMenuShortcut"
  )
  Assert-True (Test-Path -LiteralPath $userDataSentinel -PathType Leaf) (
    "Uninstall removed the userData preservation sentinel."
  )
  Assert-NoProductProcesses "NSIS uninstall" @($installedApp, $uninstaller[0].FullName)

  Write-Step "Launch Portable artifact from a path containing spaces and Chinese"
  $shortcutRoots = @($desktopDirectory, $programsDirectory)
  $shortcutsBeforePortable = @(Get-ShortcutPaths $shortcutRoots)
  $uninstallKeysBeforePortable = @(Get-UninstallKeyPaths)
  $portableTestDirectory = Join-Path $verificationRoot "中文 便携目录"
  New-Item -ItemType Directory -Path $portableTestDirectory -Force | Out-Null
  $renamedPortable = Join-Path $portableTestDirectory "星轨工作台 便携验证.exe"
  Copy-Item -LiteralPath $portablePath -Destination $renamedPortable -Force
  Invoke-SmokeTest $renamedPortable "portable-app"
  $uninstallKeysAfterPortable = @(Get-UninstallKeyPaths)
  $newPortableUninstallKeys = @(
    $uninstallKeysAfterPortable | Where-Object { $_ -notin $uninstallKeysBeforePortable }
  )
  Assert-True ($newPortableUninstallKeys.Count -eq 0) (
    "Portable launch created uninstall keys: $($newPortableUninstallKeys -join ', ')"
  )
  $shortcutsAfterPortable = @(Get-ShortcutPaths $shortcutRoots)
  $newPortableShortcuts = @(
    $shortcutsAfterPortable | Where-Object { $_ -notin $shortcutsBeforePortable }
  )
  Assert-True ($newPortableShortcuts.Count -eq 0) (
    "Portable launch created shortcuts: $($newPortableShortcuts -join ', ')"
  )

  Write-Step "Generate and verify SHA-256 manifest"
  $checksumPath = Join-Path $releasePath "SHA256SUMS-Windows-x64.txt"
  $artifacts = @(
    Get-Item -LiteralPath $installerPath
    Get-Item -LiteralPath $portablePath
  ) | Sort-Object Name
  $checksumLines = @(
    foreach ($artifact in $artifacts) {
      $hash = (Get-FileHash -LiteralPath $artifact.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
      "$hash  $($artifact.Name)"
    }
  )
  $checksumLines | Set-Content $checksumPath -Encoding utf8NoBOM
  Assert-True ($checksumLines.Count -eq 2) "Checksum manifest does not contain two artifacts."
  $manifestLines = @(Get-Content -LiteralPath $checksumPath)
  Assert-True ($manifestLines.Count -eq 2) (
    "Persisted checksum manifest does not contain exactly two entries."
  )
  $manifestNames = [System.Collections.Generic.HashSet[string]]::new(
    [System.StringComparer]::Ordinal
  )
  foreach ($line in $manifestLines) {
    Assert-True ($line -match "^([0-9a-f]{64})  (.+\.exe)$") "Malformed checksum line: $line"
    $manifestName = $Matches[2]
    Assert-True (
      $manifestName -eq $expectedInstallerName -or
      $manifestName -eq $expectedPortableName
    ) "Checksum manifest contains an unexpected artifact: $manifestName"
    Assert-True ($manifestNames.Add($manifestName)) (
      "Checksum manifest contains a duplicate artifact: $manifestName"
    )
    $manifestArtifact = Join-Path $releasePath $manifestName
    Assert-NonEmptyFile $manifestArtifact "Checksum artifact"
    $actualHash = (
      Get-FileHash -LiteralPath $manifestArtifact -Algorithm SHA256
    ).Hash.ToLowerInvariant()
    Assert-True ($actualHash -eq $Matches[1]) "Checksum mismatch for $manifestName."
  }
  Assert-True (
    $manifestNames.Contains($expectedInstallerName) -and
    $manifestNames.Contains($expectedPortableName)
  ) "Checksum manifest does not cover both exact Windows artifacts."

  @(
    "Windows package verification passed."
    "Version: $ExpectedVersion"
    "Installer: $expectedInstallerName"
    "Portable: $expectedPortableName"
    "Install path: $installDirectory"
    "Portable test path: $renamedPortable"
    "User data preservation sentinel: retained after uninstall"
  ) | Set-Content $summaryPath -Encoding utf8NoBOM
} catch {
  $failure = $_
  @(
    "Windows package verification failed."
    "Version: $ExpectedVersion"
    "Error: $($_.Exception.Message)"
    "Script stack: $($_.ScriptStackTrace)"
  ) | Set-Content $summaryPath -Encoding utf8NoBOM
} finally {
  if (
    -not [string]::IsNullOrWhiteSpace([string]$userDataSentinel) -and
    (Test-Path -LiteralPath $userDataSentinel -PathType Leaf)
  ) {
    try {
      Remove-Item -LiteralPath $userDataSentinel -Force
    } catch {
      Write-Warning "Could not remove the exact userData test sentinel: $($_.Exception.Message)"
    }
  }
  try {
    Remove-TestInstallation
  } catch {
    Write-Warning "Could not complete exact test-install cleanup: $($_.Exception.Message)"
  }
  if (-not [string]::IsNullOrWhiteSpace([string]$verificationRoot)) {
    try {
      $normalizedVerificationRoot = [System.IO.Path]::GetFullPath($verificationRoot).TrimEnd("\", "/")
      $normalizedRunnerTemp = [System.IO.Path]::GetFullPath($runnerTemp).TrimEnd("\", "/")
      $verificationLeaf = [System.IO.Path]::GetFileName($normalizedVerificationRoot)
      $safeVerificationRoot = (
        $normalizedVerificationRoot.StartsWith(
          "$normalizedRunnerTemp$([System.IO.Path]::DirectorySeparatorChar)",
          [System.StringComparison]::OrdinalIgnoreCase
        ) -and
        $verificationLeaf -match "^Orbit Workbench CI-[0-9a-f]{32}$"
      )
      if (-not $safeVerificationRoot) {
        throw "Refusing to clean an unexpected verification root: $verificationRoot"
      }
      if (Test-Path -LiteralPath $normalizedVerificationRoot -PathType Container) {
        Remove-Item -LiteralPath $normalizedVerificationRoot -Recurse -Force
      }
    } catch {
      Write-Warning "Could not clean the exact Windows verification root: $($_.Exception.Message)"
    }
  }
  try {
    Write-Diagnostics
  } catch {
    Write-Warning "Could not write all Windows diagnostics: $($_.Exception.Message)"
  }
  if ($transcriptStarted) {
    try {
      Stop-Transcript | Out-Null
    } catch {
      Write-Warning "Could not stop the Windows verification transcript: $($_.Exception.Message)"
    }
  }
}

if ($null -ne $failure) {
  throw $failure
}

Write-Host ""
Write-Host "Windows package verification passed." -ForegroundColor Green
