// Usage: node scripts/decrypt-backup.mjs <backup.db.enc> <output.db>   (asks for the passphrase)
import crypto from 'node:crypto';
import fs from 'node:fs';
import zlib from 'node:zlib';
import readline from 'node:readline';
const [, , input, output] = process.argv;
if (!input || !output) { console.error('Usage: node scripts/decrypt-backup.mjs <backup.db.enc> <output.db>'); process.exit(1); }
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Passphrase: ', pass => {
  rl.close();
  const buf = fs.readFileSync(input);
  if (buf.subarray(0, 8).toString() !== 'KMCBENC1') { console.error('This is not an encrypted backup from the College ERP.'); process.exit(1); }
  try {
    const key = crypto.scryptSync(pass, buf.subarray(8, 24), 32);
    const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(24, 36)); d.setAuthTag(buf.subarray(36, 52));
    fs.writeFileSync(output, zlib.gunzipSync(Buffer.concat([d.update(buf.subarray(52)), d.final()])));
    console.log('Done. Restore it from System -> Backup -> "Restore from a file".');
  } catch { console.error('Wrong passphrase, or the file is damaged.'); process.exit(1); }
});
