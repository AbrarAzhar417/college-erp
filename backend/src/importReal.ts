// npm run import:real          adds the real KMCB students (classes XI, XII) to the database in use
// npm run import:real -- --dry  only shows what would happen
import { ensureBaseData } from './db.js';
import { upgradeDatabase } from './upgrade.js';
import { importRealStudents } from './realStudents.js';

ensureBaseData(); upgradeDatabase();
const dry = process.argv.includes('--dry');
const r = importRealStudents(dry) as any;
if (r.error) { console.error(r.error); process.exit(1); }
if (dry) console.log('Would add:', JSON.stringify(r.counts));
else console.log(`Added ${r.saved} students, ${r.duplicates} already there, ${r.errors} not saved, ${r.families_linked} brothers/sisters linked.`);
if (r.errors) console.log(r.rejected_csv);
