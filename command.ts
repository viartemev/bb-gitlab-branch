import { execFile } from "node:child_process";
export type Run = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    signal?: AbortSignal;
    token?: string;
    allowFailure?: boolean;
  },
) => Promise<string>;
export const run: Run = (command, args, options) =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd: options.cwd,
        signal: options.signal,
        timeout: 25000,
        maxBuffer: 8 * 1024 * 1024,
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GLAB_CHECK_UPDATE: "false",
          NO_COLOR: "1",
          ...(options.token ? { GITLAB_TOKEN: options.token } : {}),
        },
      },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout);
        if (options.allowFailure && typeof error.code === "number")
          return resolve("");
        if (options.signal?.aborted)
          return reject(new Error("GitLab request cancelled"));
        if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
          return reject(
            new Error(
              "Ответ GitLab превышает 8 MiB. Откройте полный лог или данные в GitLab.",
            ),
          );
        if (error.code === "ENOENT")
          return reject(
            new Error(
              `${command} is not installed on the environment machine. Install git and glab, then run glab auth login on that machine.`,
            ),
          );
        // Never expose environment values, command arguments or a possibly credential-bearing remote.
        const status = stderr.match(
          /(?:HTTP|status(?: code)?)[\s:]+(\d{3})/i,
        )?.[1];
        reject(
          new Error(
            status
              ? `GitLab returned HTTP ${status}. Check access, authentication and project permissions.`
              : `${command} failed or timed out. Check authentication, VPN and corporate CA certificates on the environment machine.`,
          ),
        );
      },
    );
  });
