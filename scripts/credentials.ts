// Prints the passwords and API keys JARVIS stored for the operator: npm run credentials
import path from "node:path";
import { CredentialVault } from "../src/integrations/vault.js";

const token = process.env.JARVIS_TOKEN;
if (!token) throw new Error("JARVIS_TOKEN is not set; run from the repository with its .env");
const entries = await new CredentialVault(path.resolve("data/vault.json"), token).list();
for (const [name, value] of Object.entries(entries)) console.log(`${name}\t${value}`);
if (!Object.keys(entries).length) console.log("The vault is empty.");
