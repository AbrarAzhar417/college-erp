# Putting the College ERP into daily use (deployment guide)

## 1. Where to run it
Pick ONE computer that stays on during college hours (an office PC or a small server). Everyone else opens it in a browser.
- Inside the college only: staff open `http://<server-PC-IP>:3000` on the college WiFi. Nothing else is needed.
- Parents' online result page (`/result`) needs the server reachable from the internet: see section 5.

## 2. First start
```
cd backend && npm install && npm run build      (or use setup.bat on Windows)
cd ../frontend && npm install && npx ng build
cd ../backend && npm start                      (or start.bat)
```
Run `npm test` in `backend` once; it must finish without a red line.

## 3. Settings (environment variables)
| Name | Meaning |
|---|---|
| `JWT_SECRET` | A long random text. **Set this**; otherwise a secret file is created in the data folder (also fine, but then keep that file safe). |
| `DATA_DIR` | Folder of the database. Put it on a drive that is backed up. Default: `backend/data`. |
| `BACKUP_DIR` | Where backups go. Default: `DATA_DIR/backups`. Point it to a second disk or a synced folder (OneDrive, Google Drive). |
| `BACKUP_KEEP` | How many automatic daily backups to keep (default 14). |
| `PORT` | Default 3000. |
| `TRUST_PROXY` | Set to `1` when nginx/Caddy is in front, so the real visitor address is used for limits and the audit log. |

## 4. Keep it running and safe
- Windows: put a shortcut to `start.bat` in the Startup folder, or use NSSM to run it as a service. Linux: `pm2 start "npm start" --name erp && pm2 save && pm2 startup`.
- **Backups**: one automatic backup per day is made by the program. In System & Safety → Backup, also download a copy to a USB drive every week. Test a restore once on a spare PC.
- Change every demo password and switch demo mode off before real data goes in.
- Windows power settings: switch off sleep on the server PC.

## 5. Parents' online result (optional)
1. Put HTTPS in front: easiest is Caddy (`erp.yourcollege.pk { reverse_proxy localhost:3000 }`) or Cloudflare Tunnel (no router changes). With nginx use certbot for the certificate.
2. Start the server with `TRUST_PROXY=1`.
3. In System & Safety → Online results switch the lookup ON. Parents open `https://erp.yourcollege.pk/result`.
Only the registration number + father's CNIC unlock a result, only published results are shown, and repeated wrong tries are blocked. If you do not want the portal on the internet at all, leave the switch OFF.
Note: the staff login page is then also reachable from the internet; use strong passwords (8+ characters) and keep the audit log in view.

## 6. SMS to parents
Install a free "SMS Gateway" app on an Android phone with a SIM, keep it on the same WiFi, and enter its address in HR → Settings → Email and SMS. WhatsApp messages are opened as ready-made chats; a person presses Send (WhatsApp cannot be sent automatically without a business account).

## 7. Urdu printing
Notices, circulars and parent messages detect Urdu text line by line and print it right-to-left. Windows 10/11 already has the "Urdu Typesetting" (Nastaliq) font; if you prefer another, install "Noto Nastaliq Urdu" or "Jameel Noori Nastaleeq" on the PC that prints. Type Urdu with the Windows Urdu keyboard or a Pakistan phonetic keyboard.

## 8. New session (every April)
System & Safety → New session. Tick any student who must repeat the class, type PROMOTE. A backup is taken first. Then check teachers' subject assignments and timetable for the new classes, because those are tied to the old sections.

## 9. Phone use for teachers (installable app, weak internet)
- Teachers open the college address in Chrome on their phone and choose "Add to Home screen". It then opens like an app.
- **Installing the app and opening it with no internet needs HTTPS** (a phone browser allows this only on `https://` addresses). Use section 5 (Caddy or Cloudflare Tunnel). Over plain `http://192.168...` the site still works on WiFi, but it cannot be installed.
- Even without HTTPS, attendance and marks that fail to send because the internet dropped are kept on the phone and sent automatically when the connection returns (a yellow bar shows how many are waiting). Only attendance (daily and period) and marks entry are kept this way.
- Lists already opened are kept for a day so a class can still be seen offline; they are wiped from the phone at logout.

## 10. Offline use and the QR codes
The system needs no internet once it is installed. Everything (database, screens, photos, prints) lives on the server PC, and every other PC or phone on the same WiFi or LAN opens it in a browser.
1. Start the server (`start.bat`). The window prints "Other devices on this network: http://192.168.x.x:3000".
2. In **College Profile**, put that address in "Address this system is opened with". It is printed into the QR codes of the ID and transport cards.
3. A phone on the college WiFi that scans a card opens `.../scan/<admission no>`; after login it lands on that student's profile. Without WiFi, the phone's scanner still shows the admission number as text.
4. Give the server PC a fixed address (router setting "DHCP reservation", or a static IP in Windows) so the QR addresses stay valid. If the address changes, update it in College Profile and reprint the cards.
5. Allow port 3000 through Windows Firewall (see section 1) and keep the PC on during college hours.
Fee receipt QR codes check a receipt on the same address, so they work on the college network too.

## 11. Free hosting for a demo (not for real student data)
Use demo data only: run `npm run seed:demo`, or start with `DEMO_SEED=1`, which fills an empty database with demo students.
- **From the college or your own PC (easiest, free, no account):** start the server, install `cloudflared`, and double-click `demo-online.bat` (it runs `cloudflared tunnel --url http://localhost:3000`). It prints a `trycloudflare.com` link you can send to anyone. Cloudflare documents these quick tunnels as for testing and development, with no uptime guarantee; the link changes every time and stops when the window closes.
- **A free cloud host with Docker:** the `Dockerfile` in this folder builds one image. Run it with `DEMO_SEED=1` and a `JWT_SECRET`. On Render's free web service the local files are not kept (a local SQLite database is lost on redeploy, restart or spin-down), the service sleeps after 15 minutes without visitors and takes about a minute to wake, and there are 750 free hours a month. For a demo that is acceptable because `DEMO_SEED=1` rebuilds the demo data on every start; it must never hold real data. I wrote the Dockerfile but have not been able to run it or deploy it to Render here, so try it once before the day of the demo.
- Real data belongs on the college PC with the daily backup (section 4), not on a free cloud host.

### 11a. Render, step by step (free demo)
A hosted demo (`DEMO_SEED=1`) is filled with invented students only. The real XI and XII students are never put on a public demo; they are added only when you seed or import on your own PC.
1. Put the project folder (the one with `Dockerfile`, `backend`, `frontend`) in a GitHub repository (private is fine): create the repository on github.com, then `git init`, `git add .`, `git commit -m "College ERP"`, `git remote add origin <repo address>`, `git push -u origin main`.
2. Sign up at render.com (GitHub login works) and connect your GitHub account.
3. New + > Web Service > pick the repository. Language/Runtime: **Docker**. Instance type: **Free**. Leave Dockerfile path as `./Dockerfile` and the root directory empty.
4. Environment variables: `DEMO_SEED` = `1` and `JWT_SECRET` = any long random text. (`PORT` is set by Render; the image already listens on it.)
5. Create Web Service. The first build takes several minutes (it builds the screens and the server). When the log says the server is listening, open the `https://<name>.onrender.com` link.
6. Log in with the demo accounts shown on the login page. After 15 idle minutes the service sleeps and the next visit takes about a minute; the demo data is rebuilt on every start.
7. In Settings > College Profile, set the public URL to the onrender link so QR codes open there.
If the build fails, copy the last 30 lines of the Render log; the usual causes are a missing folder in the repository or running out of build memory on the free plan.
