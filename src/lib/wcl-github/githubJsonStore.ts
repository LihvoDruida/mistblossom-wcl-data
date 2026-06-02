export class GithubJsonStore {
  private readonly apiBase = "https://api.github.com";

  constructor(
    private readonly options: {
      token: string;
      owner: string;
      repo: string;
      branch: string;
      committerName: string;
      committerEmail: string;
    },
  ) {}

  async readJson<T>(path: string): Promise<T | null> {
    const file = await this.getContent(path);
    if (!file) return null;

    const content = Buffer.from(file.content.replace(/\n/g, ""), "base64").toString("utf8");
    return JSON.parse(content) as T;
  }

  async writeJsonSerial(path: string, data: unknown, message: string): Promise<void> {
    const body = JSON.stringify(data, null, 2) + "\n";
    await this.putContentWithRetry(path, body, message);
  }

  private async getContent(path: string): Promise<{ sha: string; content: string } | null> {
    const url = `${this.apiBase}/repos/${this.options.owner}/${this.options.repo}/contents/${encodeURIComponentPath(
      path,
    )}?ref=${encodeURIComponent(this.options.branch)}`;

    const response = await fetch(url, {
      method: "GET",
      headers: this.headers(),
      cache: "no-store",
    });

    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`GitHub read failed ${response.status}: ${await response.text()}`);
    }

    const json = (await response.json()) as { sha: string; content: string; type: string };
    if (json.type !== "file") {
      throw new Error(`GitHub path is not a file: ${path}`);
    }

    return { sha: json.sha, content: json.content };
  }

  private async putContentWithRetry(path: string, content: string, message: string): Promise<void> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const existing = await this.getContent(path);
      const payload: Record<string, unknown> = {
        message,
        content: Buffer.from(content, "utf8").toString("base64"),
        branch: this.options.branch,
        committer: {
          name: this.options.committerName,
          email: this.options.committerEmail,
        },
      };

      if (existing?.sha) payload.sha = existing.sha;

      const url = `${this.apiBase}/repos/${this.options.owner}/${this.options.repo}/contents/${encodeURIComponentPath(
        path,
      )}`;

      const response = await fetch(url, {
        method: "PUT",
        headers: this.headers(),
        body: JSON.stringify(payload),
      });

      if (response.ok) return;

      const text = await response.text();
      lastError = new Error(`GitHub write failed ${response.status}: ${text}`);

      if (response.status !== 409 && response.status !== 422) {
        throw lastError;
      }

      await sleep(500 * attempt);
    }

    throw lastError instanceof Error ? lastError : new Error("GitHub write failed");
  }

  private headers(): Record<string, string> {
    return {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${this.options.token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "wcl-github-api-mechanism",
    };
  }
}

function encodeURIComponentPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
