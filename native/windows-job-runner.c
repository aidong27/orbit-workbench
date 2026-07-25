#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#define WIN32_LEAN_AND_MEAN

#include <windows.h>

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <wchar.h>

enum RunnerExitCode {
  RUNNER_INVALID_ARGUMENTS = 64,
  RUNNER_PARENT_UNAVAILABLE = 65,
  RUNNER_JOB_SETUP_FAILED = 66,
  RUNNER_STDIO_SETUP_FAILED = 67,
  RUNNER_COMMAND_LINE_FAILED = 68,
  RUNNER_CHILD_START_FAILED = 69,
  RUNNER_CHILD_ASSIGN_FAILED = 70,
  RUNNER_CHILD_RESUME_FAILED = 71,
  RUNNER_WAIT_FAILED = 72,
  RUNNER_PARENT_EXITED = 73,
};

static void report_windows_error(const wchar_t *operation, DWORD error_code) {
  fwprintf(stderr, L"windows-job-runner: %ls failed (win32=%lu)\n", operation,
           (unsigned long)error_code);
  fflush(stderr);
}

static int parse_parent_pid(const wchar_t *value, DWORD *parent_pid) {
  wchar_t *end = NULL;
  unsigned long long parsed = wcstoull(value, &end, 10);
  if (value[0] == L'\0' || end == NULL || end[0] != L'\0' || parsed == 0 ||
      parsed > UINT32_MAX) {
    return 0;
  }
  *parent_pid = (DWORD)parsed;
  return 1;
}

static HANDLE duplicate_standard_handle(DWORD identifier) {
  HANDLE source = GetStdHandle(identifier);
  HANDLE duplicate = NULL;
  if (source == NULL || source == INVALID_HANDLE_VALUE) {
    return NULL;
  }
  if (!DuplicateHandle(GetCurrentProcess(), source, GetCurrentProcess(), &duplicate, 0, TRUE,
                       DUPLICATE_SAME_ACCESS)) {
    return NULL;
  }
  return duplicate;
}

static int append_character(wchar_t *buffer, size_t capacity, size_t *length, wchar_t character) {
  if (*length + 1 >= capacity) {
    return 0;
  }
  buffer[*length] = character;
  *length += 1;
  buffer[*length] = L'\0';
  return 1;
}

static int append_repeated(wchar_t *buffer, size_t capacity, size_t *length, wchar_t character,
                           size_t count) {
  for (size_t index = 0; index < count; index += 1) {
    if (!append_character(buffer, capacity, length, character)) {
      return 0;
    }
  }
  return 1;
}

/*
 * Quote one argv value according to the CommandLineToArgvW/MS CRT rules.
 * Every value is quoted so whitespace, Unicode, quotes, and trailing
 * backslashes are preserved without invoking a shell.
 */
static int append_quoted_argument(wchar_t *buffer, size_t capacity, size_t *length,
                                  const wchar_t *argument) {
  if (!append_character(buffer, capacity, length, L'"')) {
    return 0;
  }

  size_t backslashes = 0;
  for (const wchar_t *cursor = argument;; cursor += 1) {
    const wchar_t character = *cursor;
    if (character == L'\\') {
      backslashes += 1;
      continue;
    }
    if (character == L'"') {
      if (!append_repeated(buffer, capacity, length, L'\\', backslashes * 2 + 1) ||
          !append_character(buffer, capacity, length, L'"')) {
        return 0;
      }
      backslashes = 0;
      continue;
    }
    if (character == L'\0') {
      if (!append_repeated(buffer, capacity, length, L'\\', backslashes * 2) ||
          !append_character(buffer, capacity, length, L'"')) {
        return 0;
      }
      return 1;
    }
    if (!append_repeated(buffer, capacity, length, L'\\', backslashes) ||
        !append_character(buffer, capacity, length, character)) {
      return 0;
    }
    backslashes = 0;
  }
}

static wchar_t *build_command_line(int argument_count, wchar_t **arguments, int first_command) {
  size_t capacity = 1;
  for (int index = first_command; index < argument_count; index += 1) {
    const size_t argument_length = wcslen(arguments[index]);
    if (argument_length > (SIZE_MAX - capacity - 4) / 2) {
      return NULL;
    }
    capacity += argument_length * 2 + 4;
  }

  wchar_t *command_line = (wchar_t *)calloc(capacity, sizeof(wchar_t));
  if (command_line == NULL) {
    return NULL;
  }

  size_t length = 0;
  for (int index = first_command; index < argument_count; index += 1) {
    if (index > first_command &&
        !append_character(command_line, capacity, &length, L' ')) {
      free(command_line);
      return NULL;
    }
    if (!append_quoted_argument(command_line, capacity, &length, arguments[index])) {
      free(command_line);
      return NULL;
    }
  }
  return command_line;
}

int wmain(int argument_count, wchar_t **arguments) {
  if (argument_count < 5 || wcscmp(arguments[1], L"--parent-pid") != 0 ||
      wcscmp(arguments[3], L"--") != 0) {
    fwprintf(stderr,
             L"windows-job-runner: expected --parent-pid <pid> -- <executable> [arguments]\n");
    return RUNNER_INVALID_ARGUMENTS;
  }

  DWORD parent_pid = 0;
  if (!parse_parent_pid(arguments[2], &parent_pid)) {
    fwprintf(stderr, L"windows-job-runner: invalid parent pid\n");
    return RUNNER_INVALID_ARGUMENTS;
  }

  HANDLE parent_process = OpenProcess(SYNCHRONIZE, FALSE, parent_pid);
  if (parent_process == NULL) {
    report_windows_error(L"OpenProcess(parent)", GetLastError());
    return RUNNER_PARENT_UNAVAILABLE;
  }

  HANDLE job = CreateJobObjectW(NULL, NULL);
  if (job == NULL) {
    report_windows_error(L"CreateJobObjectW", GetLastError());
    CloseHandle(parent_process);
    return RUNNER_JOB_SETUP_FAILED;
  }

  JOBOBJECT_EXTENDED_LIMIT_INFORMATION job_limits;
  ZeroMemory(&job_limits, sizeof(job_limits));
  job_limits.BasicLimitInformation.LimitFlags =
      JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;
  if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &job_limits,
                               sizeof(job_limits))) {
    report_windows_error(L"SetInformationJobObject", GetLastError());
    CloseHandle(job);
    CloseHandle(parent_process);
    return RUNNER_JOB_SETUP_FAILED;
  }

  HANDLE child_stdin = duplicate_standard_handle(STD_INPUT_HANDLE);
  HANDLE child_stdout = duplicate_standard_handle(STD_OUTPUT_HANDLE);
  HANDLE child_stderr = duplicate_standard_handle(STD_ERROR_HANDLE);
  if (child_stdin == NULL || child_stdout == NULL || child_stderr == NULL) {
    report_windows_error(L"DuplicateHandle(stdio)", GetLastError());
    if (child_stdin != NULL) CloseHandle(child_stdin);
    if (child_stdout != NULL) CloseHandle(child_stdout);
    if (child_stderr != NULL) CloseHandle(child_stderr);
    CloseHandle(job);
    CloseHandle(parent_process);
    return RUNNER_STDIO_SETUP_FAILED;
  }

  wchar_t *command_line = build_command_line(argument_count, arguments, 4);
  if (command_line == NULL) {
    fwprintf(stderr, L"windows-job-runner: could not allocate the command line\n");
    CloseHandle(child_stdin);
    CloseHandle(child_stdout);
    CloseHandle(child_stderr);
    CloseHandle(job);
    CloseHandle(parent_process);
    return RUNNER_COMMAND_LINE_FAILED;
  }

  STARTUPINFOW startup;
  PROCESS_INFORMATION child;
  ZeroMemory(&startup, sizeof(startup));
  ZeroMemory(&child, sizeof(child));
  startup.cb = sizeof(startup);
  startup.dwFlags = STARTF_USESTDHANDLES;
  startup.hStdInput = child_stdin;
  startup.hStdOutput = child_stdout;
  startup.hStdError = child_stderr;

  const DWORD creation_flags = CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW;
  const BOOL created =
      CreateProcessW(arguments[4], command_line, NULL, NULL, TRUE, creation_flags, NULL, NULL,
                     &startup, &child);
  const DWORD create_error = created ? ERROR_SUCCESS : GetLastError();
  free(command_line);
  CloseHandle(child_stdin);
  CloseHandle(child_stdout);
  CloseHandle(child_stderr);

  if (!created) {
    report_windows_error(L"CreateProcessW", create_error);
    CloseHandle(job);
    CloseHandle(parent_process);
    return RUNNER_CHILD_START_FAILED;
  }

  if (!AssignProcessToJobObject(job, child.hProcess)) {
    const DWORD assign_error = GetLastError();
    TerminateProcess(child.hProcess, RUNNER_CHILD_ASSIGN_FAILED);
    WaitForSingleObject(child.hProcess, 5000);
    report_windows_error(L"AssignProcessToJobObject", assign_error);
    CloseHandle(child.hThread);
    CloseHandle(child.hProcess);
    CloseHandle(job);
    CloseHandle(parent_process);
    return RUNNER_CHILD_ASSIGN_FAILED;
  }

  if (ResumeThread(child.hThread) == (DWORD)-1) {
    const DWORD resume_error = GetLastError();
    TerminateJobObject(job, RUNNER_CHILD_RESUME_FAILED);
    WaitForSingleObject(child.hProcess, 5000);
    report_windows_error(L"ResumeThread", resume_error);
    CloseHandle(child.hThread);
    CloseHandle(child.hProcess);
    CloseHandle(job);
    CloseHandle(parent_process);
    return RUNNER_CHILD_RESUME_FAILED;
  }
  CloseHandle(child.hThread);

  HANDLE wait_handles[2] = {child.hProcess, parent_process};
  const DWORD wait_result = WaitForMultipleObjects(2, wait_handles, FALSE, INFINITE);
  DWORD child_exit_code = RUNNER_WAIT_FAILED;

  if (wait_result == WAIT_OBJECT_0) {
    if (!GetExitCodeProcess(child.hProcess, &child_exit_code)) {
      report_windows_error(L"GetExitCodeProcess", GetLastError());
      child_exit_code = RUNNER_WAIT_FAILED;
    }
  } else if (wait_result == WAIT_OBJECT_0 + 1) {
    TerminateJobObject(job, RUNNER_PARENT_EXITED);
    WaitForSingleObject(child.hProcess, 5000);
    child_exit_code = RUNNER_PARENT_EXITED;
  } else {
    report_windows_error(L"WaitForMultipleObjects", GetLastError());
    TerminateJobObject(job, RUNNER_WAIT_FAILED);
    WaitForSingleObject(child.hProcess, 5000);
    child_exit_code = RUNNER_WAIT_FAILED;
  }

  /*
   * Closing the final job handle is the invariant: any descendant that
   * outlived the direct command is terminated by Windows before this wrapper
   * reports completion to the Electron parent.
   */
  CloseHandle(job);
  CloseHandle(child.hProcess);
  CloseHandle(parent_process);
  return (int)child_exit_code;
}
