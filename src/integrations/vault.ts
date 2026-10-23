import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

// Passwords JARVIS creates for sites and API keys it collects. They stay on this machine,
// encrypted with a key derived from the operator token; models only ever see "[secret]".
export class CredentialVault {
  private key: Buffer;
  private entries?: Record<string, string>;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private file: string,
    token: string,
  ) {
    this.key = createHash("sha256").update(`jarvis-vault:${token}`).digest();
  }

  private async load(): Promise<Record<string, string>> {
    if (this.entries) return this.entries;
    let raw: string;
    try {
      raw = await readFile(this.file, "utf8");
    } catch {
      this.entries = {};
      return this.entries;
    }
    const { iv, tag, data } = JSON.parse(raw) as Record<string, string>;
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv ?? "", "base64"));
    decipher.setAuthTag(Buffer.from(tag ?? "", "base64"));
    this.entries = JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(data ?? "", "base64")),
        decipher.final(),
      ]).toString("utf8"),
    ) as Record<string, string>;
    return this.entries;
  }

  private async store(entries: Record<string, string>): Promise<void> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(entries), "utf8"), cipher.final()]);
    await mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    await writeFile(
      temporary,
      JSON.stringify({
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        data: data.toString("base64"),
      }),
    );
    await rename(temporary, this.file);
  }

  // Writes run one at a time so two concurrent tasks never lose each other's entry.
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => {});
    return next;
  }

  async list(): Promise<Record<string, string>> {
    return { ...(await this.load()) };
  }

  async save(name: string, value: string): Promise<void> {
    await this.serial(async () => {
      const entries = { ...(await this.load()), [name]: value };
      await this.store(entries);
      this.entries = entries;
    });
  }

  // The site's existing password, or a new strong one saved before it is ever typed.
  password(origin: string): Promise<string> {
    return this.serial(async () => {
      const entries = await this.load();
      const name = `password:${origin}`;
      const existing = entries[name];
      if (existing) return existing;
      const value = generatePassword();
      const next = { ...entries, [name]: value };
      await this.store(next);
      this.entries = next;
      return value;
    });
  }

  async secrets(): Promise<string[]> {
    return Object.values(await this.load()).filter((value) => value.length >= 8);
  }
}

const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%*-_=+"];
// 20 characters with every class present, which satisfies common site password rules.
export function generatePassword(length = 20): string {
  const all = sets.join("");
  const chars = sets.map((set) => set[randomInt(set.length)] as string);
  while (chars.length < length) chars.push(all[randomInt(all.length)] as string);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j] as string, chars[i] as string];
  }
  return chars.join("");
}
