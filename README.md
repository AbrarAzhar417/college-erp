# College Portal (ERP) - Students + Timetable + Fee + Attendance + Examination + Syllabus + Transport + HR

Angular + Tailwind (frontend), Node + Express (backend), SQLite (database).
Design follows the KIT LMS reference project (dark indigo glass login, rounded cards, Plus Jakarta Sans).

## Kya kya bana hua hai
- Login (5 roles: director, principal, admin, teacher, accountant) aur password change
- Dashboard (students, boys/girls, class-wise graph, latest admissions)
- Classes & Sections: Class 6 se 12, har class mein A, B, C, D, E (35 sections), SSC (6-10) / HSSC (11-12)
- Students & Admissions: search, class/section filter, new admission, edit, remove (record database mein rehta hai)
- **Smart Timetable** (neeche tafseel): ek click par poore 35 sections ka timetable
- **Transport** (neeche tafseel): buses, routes, stops, kon si bus mein kon se bachay, fee, kharche
- **HR Management** (neeche tafseel): staff record, staff attendance, leaves, salary/payroll, recruitment (CV se hiring tak)
- **Syllabus** (neeche tafseel): hafta-ba-hafta syllabus plan, academic calendar, test ka syllabus, progress
- **Examination** (neeche tafseel): fortnightly tests, class incharge sheet, GR calls, send-up, board admission, awards
- **Attendance** (neeche tafseel): daily + period-wise, mahine ka register aur shortcut, leaves, analysis
- **Fee Management** (neeche tafseel): fee voucher (3 copies), payments, student ka poora fee record, defaulters
- Light/Dark theme, mobile par sidebar menu
- Students mein ab Roll number aur Father CNIC bhi hai (roll number khud agla number lagta hai)
- Baqi modules sidebar mein "Soon" ke saath hain (Daily Diary, Library, ...)

## College server PC par chalana (internet ke baghair)
1. Us PC par **Node.js 22 LTS** install karein (nodejs.org). Internet sirf is install ke liye chahiye.
2. Is folder mein `setup.bat` double-click karein (ek dafa, 5-10 minute).
3. `start.bat` double-click karein. Yeh window khuli rakhein.
4. Usi PC par browser mein `http://localhost:3000` kholen.
5. Dusre phones/PCs (usi WiFi/router par): `http://<server-pc-ka-IP>:3000`.
   IP maloom karne ke liye server PC par `ipconfig` chalayen (IPv4 Address).
   Agar dusre device na khulen to Windows Firewall mein port 3000 allow karein.

Internet band ho tab bhi chalega, kyunke server, database aur fonts sab usi PC par hain.

## Pehli dafa login
Default users (password sab ka `ChangeMe@123`): director, principal, admin, teacher, accountant.
**Real use se pehle har account ka password badlein** (sidebar mein apne naam par click, "Change password").
Director/principal "My Profile" se college ka naam bhi set kar sakte hain.

Demo data (282 farzi students) dekhna ho to:
```
cd backend
npm run seed:demo
```
Demo mode mein login page par quick-access buttons nazar aate hain. Real data se pehle `backend/data` folder
delete kar dein taake demo data aur demo mode khatam ho jaye.

## Backup (bohat zaroori)
Poora database `backend/data/college.db` file mein hai. Roz is `data` folder ki copy USB/dusre PC par rakhein.

## Development (aap ke liye)
```
cd backend  && npm install && npm run dev      # API on :3000
cd frontend && npm install && npm start        # Angular on :4200, /api ko :3000 par proxy karta hai
```

## Naya module kaise jorna hai
1. Backend: `backend/src/db.ts` mein table, `backend/src/server.ts` mein routes.
2. Frontend: `frontend/src/app/pages/` mein component, `app.routes.ts` mein route,
   aur `core/modules.ts` mein us module ko `built: true` ke saath sidebar mein lagayen.

## Nota
- PWA (phone par install) sirf HTTPS par chalta hai. LAN par `http://IP:3000` ke liye iski zaroorat nahi,
  yeh tab kaam aayega jab director sahb ke diye hue hosting (HTTPS) par portal chalayenge.
- Principal/Director ghar se tab hi dekh sakenge jab portal hosting par ho. LAN version aur hosting version
  ka database alag hoga (sync Phase 2+ ka kaam hai).

## Smart Timetable - istemal ka tareeqa
Sidebar mein **Timetable** kholen. Pehli dafa yeh 5 kaam is tarteeb se karein (demo data mein yeh pehle se bhare hain):
1. **Days & periods:** school ke din, roz kitne periods, period ka waqt, break kab.
2. **Subjects:** subject ka naam. "Demanding" tick karein (Math, Science...) to generator inhein subah ke periods dega.
3. **Teachers:** naam, kon se subjects parha sakte hain, roz/hafte mein zyada se zyada periods, aur kon se periods available NAHI (jaise aik teacher Saturday nahi aata).
4. **Curriculum:** har class ke liye subject aur hafte ke periods (A se E sab sections par lagta hai). Computer/Lab jaise subject "Double periods" rakh sakte hain.
5. **Auto timetable:** "Assign teachers automatically" dabayen (teachers ka load barabar baant deta hai), phir **Generate timetable**, preview dekhen, phir **Publish**.

Generator in baton ki **zamanat** deta hai (kabhi tora nahi jata, publish se pehle server dobara check karta hai):
- koi teacher ek waqt mein do jagah nahi, aur koi section ke ek period mein do subject nahi
- teacher ke "available nahi" periods aur roz ki had ka lihaz
- aik subject aik section mein aik din mein bar bar nahi (jab tak hafte ke periods zyada na hon)
- double period alag nahi hota aur break ke aar-paar nahi jata
- lock kiye hue lessons apni jagah rehte hain

Aur yeh cheezen behtar karta hai (jitna behtar ho sake): teacher ke beech ke khali periods kam, lagatar 3 se zyada periods kam, har din ka load barabar, demanding subjects subah, aik hi subject peechhe peechhe nahi.

**View & edit:** section, teacher, ya poori class din ke hisab se dekhen. "Edit by hand" mein aik lesson dabayen phir uski nayi jagah dabayen. Clash ho to server rok deta hai aur wajah batata hai. Lesson ko lock kar den to dobara generate karne par bhi wahin rahega. **Print** se kagaz par nikal sakte hain.
**Teacher absent?** Teacher view mein "Find substitutes": us din ke har period ke liye free teachers (jo woh subject parha sakte hain pehle).
Teacher account se login karen to sirf apna timetable (View) nazar aata hai (account ko teacher record se jorne ke liye `teachers.user_id` set karna hota hai; demo mein `teacher` user pehle teacher se juda hai).

**"AI" ke bare mein:** yeh generator ek optimisation algorithm hai (greedy + clash repair + simulated annealing), koi online AI service nahi, isliye internet ke baghair chalta hai. Asli chat wala AI (jaise "Monday 3rd period free kar do") hosting par internet hone ke baad alag se jora ja sakta hai.

Natija demo data par (35 sections, 56 teachers, 1280 periods): Balanced mode mein ~10 second, 0 clash, sab periods place.

## Fee Management - istemal ka tareeqa
**Pehli dafa setup (5 minute):**
1. **My Profile** (sidebar mein apne naam par click, director/principal): college ka naam, short name (KMCB), address, phone, email aur **logo upload**. Yahi sab voucher aur receipt par chhapta hai.
2. **Fee > Settings:** bank ka naam, branch, account title, account number/IBAN, late fine, voucher ki hidayat.
3. **Fee > Fee structure:** kon kon si fee hai (Tuition, Computer Lab, Annual, Transport...) aur har class ki rakam. "Extra fee" (jaise Transport) sirf unhi bachon se li jati hai jinhein lagayi jaye.
4. Purane hisab ka baqaya ho to **bachay ke fee account** mein "Add entry > Previous balance" se daal den.

**Har mahine:**
- **Generate vouchers:** mahina chunen, "Whole college" (ya class/section/aik bacha) aur **Generate vouchers**. Pehle batata hai kitne banenge aur kitni rakam hai. Dobara dabane par duplicate nahi banta.
  Annual/exam jaisi fee ke liye "Monthly fees" ka tick hata kar wo fee chunen.
- Phir **Print all**. Print window mein: Paper **A4**, **Landscape**, aur **Background graphics** ON. Har bachay ka aik page, us par teen copies: **Bank copy, Office copy, Student copy**.
- Voucher par: college ka logo/naam/address, voucher number aur **barcode**, issue/due date, bachay ka naam, walid ka naam, class-section, roll number, admission number, contact, fee ki tafseel (concession aur pichhla baqaya "Arrears" samet), due date tak kitna aur late fine ke baad kitna, **rakam alfaz mein**, bank ki tafseel, hidayat, aur dastakhat ki jagah.
- **Collect fee:** naam/roll/admission/phone likhen ya **voucher ka barcode scan** karen. Rakam, tareekh, tareeqa (cash/bank/online/cheque) aur bank slip number likh kar **Receive payment**. Late ho to late fine lagane ka option aata hai. Phir **Print receipt** (2 copies).
- **Defaulters:** jin par baqaya hai (class/section ke hisab se), CSV download ya print.
- **Overview:** is mahine kitna bill hua, kitna wasool hua, kitna baqi; roz ki **collection report** (tareekh se tareekh tak).

**Bachay ka fee record:** Students mein "Fee" dabayen (ya Fee > Vouchers mein naam). Wahan: bachay ki poori tafseel, total charged / paid / baqaya, har voucher, aur **poora statement** (kab kitna jama kiya, kab kitna charge hua, har waqt ka baqaya). **Print statement** se kagaz par. "Fee plan" mein us bachay ki alag fee (transport) aur concession (sibling discount waghera, percent ya rakam) lagayen.

**Hisab kaise chalta hai:** har bachay ka aik account hai. Voucher se charge barhta hai, payment se kam hota hai. Payment sab se purane baqaye par pehle lagti hai. Naya voucher banate waqt pichhla baqaya khud "Arrears" mein aa jata hai, aur agar bachay ne zyada jama kara diya ho to "Advance adjusted" ban jata hai. Voucher cancel ya payment cancel karne par account wapas theek ho jata hai. Cancel sirf director/principal/accountant kar sakte hain.

**Kon kya dekh sakta hai:** Fee sirf director, principal, accountant aur admin (front desk) ko nazar aata hai; teacher ko nahi.
**Demo data:** `npm run seed:demo` se Aug-Oct 2026 ke vouchers aur payments bhi ban jate hain, taake sab screens bhari hui nazar aayen.

## Attendance - istemal ka tareeqa
**Pehli dafa setup:**
1. **Attendance > Settings:** (a) minimum attendance (jaise 75%), teacher kitne purane din tak badal sakta hai; (b) **Holidays** (Eid, 14 August, garmiyon ki chhutiyan; Sunday khud off hai); (c) **Class teachers**: har section ka class teacher.
2. Teachers ko login den: **Timetable > Teachers > teacher ko Edit > "Login account"** (username + password). Phir wo apne login se sirf apni class aur apne periods ki attendance mark karta hai.

**Roz ki attendance:**
- **Daily attendance:** class teacher (ya office) section kholta hai, sab pehle se **Present** hote hain, sirf absent/leave/late wale bachon par dabata hai (P present, A absent, L leave, T late), **Save**. Late wala present gina jata hai. Chhutti ke din ya mustaqbil ki tareekh par attendance nahi lagti. Pichle din chhodne par teacher ke liye lock ho jata hai (office badal sakti hai).
- **Period attendance:** subject teacher **Period attendance** kholta hai, timetable se uske aaj ke lessons nazar aate hain; lesson dabaye, bachon ko mark kare. Jo bacha subah absent/leave tha wo khud absent/leave aata hai. Agar sirf periods mein attendance li ho to daily register mein **"Fill from period attendance"** se daily bhar sakte hain.
- **Leaves:** office bachay ki chhutti likhti hai (ya pending rakh kar baad mein approve). Approved leave ke din register mein khud **L** lag jate hain aur absent nahi ginte.

**Pure mahine ki attendance (register se dekh kar):** **Monthly register** mein teen tareeqe:
1. **Register grid:** bilkul kaghazi register jaisa. Dabane se P > A > L > T badalta hai, ya box select karke keyboard se **P / A / L / T** dabayen, **Delete** se khali, **arrow keys** se aage. "Mark every empty day as present" se sab din present, phir sirf exceptions theek karen. Har bachay ke P, A, L, T aur % saath saath nikalte hain.
2. **Quick entry (sab se tez):** har bachay ke samne sirf **absent din** likhen (jaise `3, 7, 12-14`), **leave din**, **late din**. Baqi sab school din khud **Present** lag jate hain, aur saamne hi gintiyan nazar aati hain. Poore section ko aik click mein save karen.
3. **Totals only:** agar register mein sirf total hon (din ki tafseel na ho): absent, leave, late ke din likhen, present khud nikalta hai.
**Print register:** college ke logo ke saath professional monthly register (A4 landscape), har din ka P/A/L/T, har bachay ke totals aur %, aur class teacher/principal ke dastakhat.

**Record aur analysis (Reports & analysis):**
- **Summary:** har class aur har section ka mahine ka hisab (present, late, absent, leave, %, kitne bachay minimum se neeche). Section dabane par har bachay ki list.
- **Analysis:** mahine ba mahine trend, kis din (Monday waghera) sab se zyada ghair-hazri, class ka muqabla, din ba din graph, minimum se kam % wale bachay (phone ke saath), sab se zyada absent, **lagatar 3 ya zyada din absent**, period-wise aur subject-wise attendance, aur wo bachay jo school mein hon lekin kuch periods mein absent ("bunking").
- **Bachay ka attendance:** Students mein "Attendance": 12 mahine ka hisab, calendar, subject-wise %, leaves; print bhi hota hai.
- **Today (office):** aaj kin sections ka register abhi nahi laga, aur kin teachers ne period attendance nahi lagayi.

**Hisab:** % = (present + late) / (present + late + absent + leave). Settings mein chahen to approved leave ko bhi present ginwa saktay hain. Agar kisi mahine ki day-by-day attendance bhi ho aur totals bhi, to day-by-day istemal hoti hai.
**Kon kya kar sakta hai:** director/principal/admin sab kuch; teacher sirf apni class ki daily attendance aur register, aur apne periods. Accountant ko Attendance nazar nahi aati.
**Demo data:** `npm run seed:demo` Aug-Oct 2026 ki attendance, leaves, holidays, timetable aur class teachers bhi bana deta hai (teacher login: `teacher`).

## Examination - istemal ka tareeqa
**Students mein naya record:** Student ke form mein ab **Category (A / B / C)**, **P number** (sirf A aur B ke liye, walid/walida ka special code), **Father ki phone**, **Mother ki phone** (aur pehle wala contact) likh sakte hain. Category ke naam aur meeting ki jagah **Examination > Settings** mein badal sakte hain (abhi: A = KRL mein kaam, B = KRL se retire, C = private job; A/B ki PTM **KMCB** mein, C ki **Govt Associate College Kahuta** mein).

**Har 2 hafte ka test (Test 1, Test 2, ...):**
1. **Exams > New exam:** kind "Fortnightly test", classes chunen (6 se 12), max marks (jaise 25), pass % (33). Har section ke har subject ka aik **paper** khud ban jata hai, us subject ke teacher ke naam ke saath.
2. **Subject teacher:** apne login se **My papers** kholta hai, apna paper chunta hai, **test ki date** aur max marks likhta hai, aur marks daalta hai. Marks likh kar **Enter** dabayen to agla bacha; **A** = absent, **L** = leave, khali = abhi nahi daala. Saath mein pichhle test ke marks bhi nazar aate hain. Max se zyada marks nahi ja sakte.
3. **Class incharge (class teacher):** **Class sheet** mein ek hi sheet: us section ke sab bachay, sab subjects ke marks, **total, percentage, grade, pass/fail, rank**, aur **pichhle test se muqabla** (▲ upar / ▼ neeche, kitne points, rank kitni badli). Fail wale lal, aur jinki percentage kam hui peeli. Neeche har subject aur uske teacher ka result (average, pass %).
4. **GR call:** sheet par "Make parent call (GR) list" dabane se fail ya girne wale (default 5 points ya zyada) bachay list mein aa jate hain. **Parent calls (GR)** mein har bachay ke saath: category, **P number**, sab phone numbers (dabane se call), kis wajah se, kaun se subject mein fail, **meeting ki jagah (category ke hisab se)**. Call ka status, tareekh, aur walid ne kya kaha likhen. **PTM ki tareekh:** A/B ke liye KMCB ki aur C ke liye Govt Associate College ki alag tareekh dekar bachay tick kar ke "Set meeting". **Print parent letters** (aik page par 2 notice) aur **Print call list**.
5. **Exam ka status:** Open (teacher marks daal sakte hain) > **Lock** (teacher band, class incharge sheet banata hai) > **Publish** (final). Sirf office wapas khol sakti hai.

**Send-up, pre-board, board (Exam kind chun kar, Classes 9-12):**
- **Date sheet:** exam kholen > Date sheet: class chun kar har subject ki date aur max marks (sab sections par lagti hai). **Print date sheet**, aur **Roll number slips** (aik page par 2).
- **Send-up ke baad Board admission:** is tab mein send-up ke natije se har bachay ke 3 checks: **send-up pass**, **attendance (kam az kam 75%, Settings mein badal sakte hain)**, **fee dues clear**. "Eligible" ya "Not eligible", phir status (Form ready > Sent to board > Roll no. received) aur board ka reg/roll number likhen. **Print board list** (naam, walid, DOB, class, subjects waghera). Jab tak send-up ke marks nahi aate, pichhle mukammal exam se "preview" nazar aata hai.
- Pre-board aur board ke marks bhi isi tarah paper-wise daale jate hain (board result office daal sakti hai) aur wohi sheet/result card/analysis chalta hai.

**Mazeed cheezen jo shamil hain:** **Result card** (DMC: subject-wise marks, grade, position, pichhle test se muqabla, remarks, dastakhat; aik page par aik bacha). **Analysis** (class ke har section ka muqabla, har subject aur teacher ka result, **A/B/C category ke hisab se result**, test ba test trend, top 5, sab se zyada behtar/kharab hone wale). **Grading** (A-1, A, B, C, D, E, F; Settings mein badal sakte hain). Pass ka tareeqa: koi bhi subject pass marks se kam ho to fail (ya sirf total percentage par, exam banate waqt chun sakte hain).

**Awards:** **Examination > Awards:** aik exam ya kai tests milakar chunen, (class/section bhi). Nikalta hai: **section aur class ki 1st/2nd/3rd positions, har subject ka topper, most improved (pichhle test se sab se zyada upar), distinction (80% se upar), perfect attendance (100%)**. **Print certificates** (aik page par aik, logo ke saath "Certificate of Merit") aur **Honour roll**.

**Kon kya kar sakta hai:** office (director/principal/admin) sab kuch; teacher apne papers ke marks (jab exam open ho) aur apni class ki sheet/GR calls; accountant ko Examination nazar nahi aata.
**Demo data:** `npm run seed:demo` Test 1, 2, 3, Send-up exam, categories, P numbers, phone numbers aur GR follow-ups bhi bana deta hai.

## Syllabus - istemal ka tareeqa
**Bunyadi usool:** har class ke har subject ka **aik syllabus plan**, jo us class ke **sab sections (A se E) par lagta hai**. Plan hafta-ba-hafta banta hai: har mahine ke **4 hafte** (Hafta 1 = 1 se 7, Hafta 2 = 8 se 14, Hafta 3 = 15 se 21, Hafta 4 = 22 se mahine ke aakhir tak). Session ke mahine **Syllabus > Settings** mein tay hote hain (abhi August se March).

**Subject specialist plan banata hai (Plans):**
1. **Plans > Design a new syllabus plan:** class aur subject chunen (teacher sirf wohi subjects chun sakta hai jo uske profile mein parhane wale likhe hon: Timetable > Teachers).
2. **Week-wise plan:** har mahina khol kar har hafte mein topic likhen (topic likh kar Enter). "With details" se: chapter/kitab ka hawala, kind (lesson, revision, test, project, activity), periods, **learning outcomes**, **activities/teaching method**, resources, **assessment/homework**. Topic ko upar/neeche karna, **Edit**, **Delete**, aur doosre hafte/mahine mein le jana bhi hota hai.
3. Har hafte ke saath nazar aata hai: us hafte ki **chhutti, exam, event**, aur **kitne periods planned hain aur kitne ho sakte hain** (is subject ke weekly periods aur chhutiyon ke hisab se; zyada ho to lal).
4. **Overview and books** tab: subject ka maqsad, kitabein, assessment ka tareeqa.
5. **Send for approval** dabane par plan principal/office ke paas jata hai. **Approve** hone par teacher badal nahi sakta (office "Re-open" kar sakti hai ya "Return to teacher" note ke saath). Approve par aik **version** khud save hota hai; aap bhi bade badlav se pehle **Versions** mein version save kar ke wapas ja sakte hain.
6. **Copy to...:** aik class ka plan doosri class (ya subject) mein copy karen, phir us ke hisab se badlen.

**Word/Excel wali file se (Import):** Plan mein **Import** tab: (a) **Word (.docx)** file upload karen jis mein table ho, ya (b) **CSV**, ya (c) Word/Excel se table **copy karke paste** karen. Columns ke naam (Month, Week, Topic, Chapter, Learning outcomes, Activities, Resources, Assessment, Periods) khud pehchane jate hain; khali Month/Week wale cell upar wali row ki value lete hain. Pehle **preview** nazar aata hai (ghalat rows lal), phir "Add" ya "Replace" se import karen.
**Word file banana:** plan mein **Word file** button se poora plan .docx mein download hota hai (Word mein badal kar wapas import bhi ho sakta hai).
**Files:** **Files** tab mein board ka syllabus ya koi bhi PDF/Word/Excel/image (10 MB tak) plan ke saath rakh sakte hain.

**Print:** plan mein **Print**: college ke logo ke saath professional **Syllabus Distribution Plan** (mahina, hafta aur tareekhein, topics/chapters, outcomes, activities, assessment, periods, aur dastakhat). **Plans** mein class chun kar **poori class ki kitabcha** (sab subjects). Alag se **sirf aik mahine ka plan** aur **Academic calendar** bhi print hota hai.

**Academic calendar:** har mahine ke 4 hafte, un mein **chhutiyan** (Attendance settings se), **exams** (Examination se, khud), aur aap ke **events** (PTM, sports day, deadlines: office add/delete karti hai). Print bhi hota hai.

**Test ka syllabus (khud ban jata hai):** **Test syllabus** tab: exam aur class chunen. System pichhle exam ke baad se is test tak jo topics plan mein hain wo har subject ke saath nikal deta hai (test ki date aur max marks bhi). Tareekhein badal kar dobara hisab kar sakte hain. **Print test syllabus** parents/bachon ke liye.

**Progress (kitna parha liya):** teacher **My syllabus** mein apne har section/subject ka card dekhta hai: kitna parha, kitna **hona chahiye tha** (nishan), peeche kitne topics, aur **is hafte ka topic**. **Mark progress** se har topic **Done / In progress / Not yet / Skipped**, aur "Mark the whole week done". Principal/office **Overview** mein har class aur subject ka: plan hai ya nahi, approve hua ya nahi, kitna parha hua, kaun se section peeche hain; "Waiting for your approval" ki list; aur **coverage report print**.

**Kon kya kar sakta hai:** office (director/principal/admin) sab kuch aur approve; teacher apne subject ke plan banata/badalta hai (jab tak draft ho) aur apne sections ka progress mark karta hai; accountant ko Syllabus nazar nahi aata.
**Demo data:** `npm run seed:demo` har class ke har subject ka plan (kuch approved, kuch draft, kuch abhi bane hi nahi), events, aur progress bhi bana deta hai.

## Transport - istemal ka tareeqa
**Pehli dafa setup (Transport menu):**
1. **Drivers:** driver aur conductor (naam, phone, CNIC, licence number aur **licence ki expiry**).
2. **Buses:** har bus/coaster/van: naam (Bus 1), registration, **seats**, driver, conductor, aur kaghazat ki expiry: **fitness, route permit, insurance, token tax, agli service**.
3. **Routes:** har bus line ka naam (jaise **Model Town, Kahuta, Rawalpindi**), kaun si bus lagi hai, subah/dopahar ka waqt, aur **mahana fee** (pick-drop dono ki, aur aik tarfa ki). Route kholen to wahan **stops** bhi likhen (Model Town Chowk, Main Market...), har stop ka pick/drop waqt. Kisi stop ki fee alag ho to us stop par alag fee likh sakte hain.

**Admission ke waqt transport:** Students > New admission mein **Transport** ka hissa hai: "Does not need transport" ya **route** chunen (saath mein bacha hua seats likha hota hai), phir **stop**, aur **Pick and drop / sirf pick up / sirf drop**. Wahin mahana transport fee nazar aati hai. Purane student ko bhi Edit se bus de sakte hain. Students ki list mein **Bus** ka column hai.
**Fee khud lagti hai:** bus milte hi us bachay ke mahana fee voucher mein **Transport Fee** khud shamil ho jati hai (Fee > Fee structure mein alag se rakam daalne ki zaroorat nahi). Bus se utarne par agle voucher se band. Route ya stop ki fee badlen to us route ke **sab bachon** ki fee agle voucher se badal jati hai.

**Kon si bus mein kon kon:** **Overview** mein har route ka card (bus, driver, seats kitni bhari). Card dabane se **us bus ka page**: stop-ba-stop sab bachay (naam, walid, class, roll, phone, pick/drop, fee, **kitni fee baqi hai**). Wahin se: bachay ka **stop badalna**, bus se hatana, **naya bachaa jorna** (naam se dhoond kar), stops badalna, aur "**bus kharab ho gayi**": poori bus ke bachay doosri route mein aik click se. **Print student list** (driver ke liye stop-wise) aur **Print bus passes** (har bachay ka pass, aik page par 9, barcode ke saath).
**Students on buses:** sab transport wale bachay aik jagah, route/class/naam se filter, aur wahin se route/stop/mode badalna.

**Seats ka hisab:** agar bus mein seats se zyada bachay ho jayen to Overview mein **alert** aur route ka card lal ("too many"). Bus ke saath koi bacha jorte waqt bhi warning aati hai.
**Alerts (Overview ke upar):** kisi bus ka fitness/permit/insurance/tax/service ya driver ke licence ki expiry **30 din ke andar ya guzar chuki** ho; bus ka driver na ho; route ki bus na ho.

**Bus attendance:** route, tareekh aur trip (subah/dopahar) chun kar har bachay ke samne **Boarded / Did not come**; "Everybody boarded" se sab; jo bacha school se hi ghair-hazir ho us par nishan aata hai.
**Expenses:** (hata diye gaye) Transport mein ab kharche/diesel/licence ka hisaab nahi; report sirf seats, fee income aur bus par aane ki shurah dikhati hai.
**Reports:** mahine ka hisab har route ka: bachay, seats kitni bhari, **fee ki aamdani**, **bus par kharcha**, **bachat ya nuqsan**, har bachay par kharcha, aur kitne % bachay bus mein aaye. Print bhi hota hai. **Buses and documents** ki rapat bhi print hoti hai (laal = expire ho chuka).

**Kon kya kar sakta hai:** director, principal, admin sab kuch; **accountant sirf dekh sakta hai** (fee ke hisab ke liye); teacher ko Transport nazar nahi aata.
**Demo data:** `npm run seed:demo` 5 buses, drivers, 5 routes (Model Town, Kahuta, Rawalpindi, Lehtrar Road, Gulshan Colony) stops ke saath, bachay, kharche aur bus attendance bana deta hai (Gulshan Colony ki coaster jaan boojh kar seats se zyada bhari hai taake alert dikhe).


## HR Management - istemal ka tareeqa
**Pehli dafa:** HR > Staff mein **"Bring in existing teachers and drivers"** dabayen: Timetable ke teachers aur Transport ke drivers HR mein aa jate hain (dobara dabane se kuch double nahi hota). Naya teacher ya driver HR se add karen to wo khud Timetable / Transport mein bhi aa jata hai. Staff chhorne par wo timetable aur bus se hat jata hai aur login band ho jata hai, lekin record rehta hai.

**Staff:** naam, CNIC, photo, type (teacher, office, accounts, driver, conductor, naib qasid/security, lab attendant), designation, department, joining, contract/probation ki akhri tareekh, documents (CNIC, degree... expiry ke saath). Contract, licence ya document khatam hone se pehle Overview mein alert aata hai. Principal/director staff ka **login** bhi bana sakte hain (teacher, admin, accountant).

**Attendance:** HR > Attendance > "Mark a day": sab pehle se present hote hain, sirf Absent / Leave / Late / Half day lagayen. Time in likhen to Settings ke late time ke baad ka time khud Late ban jata hai. "Month register" mein poora mahina, aur print. College ki holidays (Attendance settings wali) khud off hoti hain. **Attendance sirf office (admin, principal, director) lagati hai.**

**Leaves:** kisam (casual, sick, annual, maternity, unpaid) aur saalana quota Settings mein. Office ya staff khud (My HR se) leave likhta hai, **principal/director approve ya reject** karta hai; approve hote hi leave attendance register mein lag jati hai.

**Salary (Payroll):**
1. Salary & loans mein har staff ka basic, allowances (house, medical, conveyance, other) aur fixed deduction likhen.
2. Payroll mein mahina chunen, **Make salary sheet** dabayen. Katauti: **absent din** (half day = aadha din), **unpaid leave**, aur joining se pehle / chhorne ke baad ke din. Aik din ki salary = salary / 30 (Settings mein "school days" bhi chun sakte hain). **Late par katauti default band hai**; Settings mein "3 late = 1 din" jaisa qanoon laga sakte hain.
3. Bonus, overtime, arrears, advance aur other deduction mahine ke hisab se likhen, phir "Recalculate drafts". **Advance/Loan** qist ke hisab se agle mahino ki salary se khud katta hai (Salary & loans > Advance and loan).
4. Sheet ka status: **Draft -> Approved (principal/director) -> Paid (accountant/principal/director)**. Approved aur Paid sheet lock ho jati hai; zaroorat par principal "Reopen" kar sakta hai (Paid wapas nahi khulti).
5. Salary sheet aur har staff ki **payslip** (college ke logo ke saath) print hoti hai. Jin dino ki attendance nahi lagi un ki katauti nahi hoti, sheet par unki tadad likhi aati hai.

**Recruitment:**
- **Job posts:** post, seats, qualification, experience, salary, akhri tareekh; advertisement print hota hai.
- **Candidates:** CV (PDF, Word, JPG, PNG) ke saath ek ek karke, ya **aik saath bohat se CV** upload (har file se candidate ban jata hai). Screening: search, post, stage, kam az kam tajurba, stars (1 se 5), "CV wale". Select karke **Shortlist / Not selected / Interview ke liye bulayen**.
- **Interview:** date, pehla time aur "har aik ko kitne minute" likhen to sab ko alag alag time slot mil jata hai. Baad mein result, score aur feedback likhen.
- **Message (WhatsApp / SMS / Email):** template (interview call, shortlist, offer, reject) mein naam, post, date, time, jagah khud bhar jati hai. **WhatsApp aur SMS ke "next" button se ek click mein agle candidate ka message tayar khulta hai (aap bhejen dabate hain), Email sab ko aik click mein (BCC).** SMS phone ki SIM se jata hai, is liye ye page phone par kholen. Kisko kya bheja, candidate ke page par likha rehta hai. Dhyan rahe: ye apps khulte hain, khud bhejne ke liye koi paid service (WhatsApp API / SMS gateway) nahi lagi.
- **Offer aur Hire:** offer (salary, joining date) banayen, offer letter print karen, phir **Complete hiring** dabayen: candidate staff ban jata hai aur uska CV staff record mein chala jata hai.

**Reports:** staff attendance summary, mahine ka salary kharcha (department ke hisab se), leave report, joined/left. Sab print aur CSV (Excel).

**Kon kya dekhta hai:** director/principal sab kuch; **admin** staff, attendance, leaves, recruitment (salary nahi dekhta); **accountant sirf Payroll, Salary & loans aur salary report**; **teacher sirf "My HR"**: apni profile, attendance, leave balance, leave likhna, apni approved payslip.

**Demo data:** `npm run seed:demo` mein ab staff, 3 mahine ki attendance, leaves, aik loan, 3 mahine ki salary sheet (do paid, aik approved), 2 job posts aur 9 candidates bhi aate hain.

## Student Profile & Result Cards - istemal ka tareeqa
- **Students** page mein kisi bhi student ke naam (ya "Profile" button) par click karein: poora profile khulta hai - photo, class/section, father, CNIC, phones, address, bus, attendance.
- Profile ke 3 tab hain: **Overview** (details + latest result, average, position), **Results** (har exam: Test 1, Test 2, Terminal, Send-up, Pre-board, Annual... har subject ke marks, %, grade, section average, rank, pichhle exam se farq), **Analysis** (percentage ka graph vs section average, subject x exam table, sab se mazboot/kamzor subject, girte/barhte subjects).
- **Photo**: New admission / Edit student mein "Choose photo". Photo khud chhoti ho jati hai (~10 KB). Result card, certificate aur progress report par chhapti hai.
- **Print**: Result card par photo + har subject ke marks (Max/Obtained/%/Grade/Result). Profile se kisi ek exam ka sirf us student ka card ("Print result card") ya saare exams ka "Print progress report" nikal sakte hain. Certificate of Merit par photo aur (single exam ke liye) har subject ke marks aate hain.
- Teacher sirf apni class (class teacher) ke students ka result dekh sakta hai; accountant ko exam results nahi dikhte.

## Admission: Siblings, Category fees, Form print
- **Siblings**: Admission form mein father CNIC ya phone (father/mother/home) likhte hi system database mein dhoondta hai: "2 siblings already studying" - un ke naam, class aur admission no. neeche aa jate hain. Naam par click karein to unka profile (nayi tab mein) khulta hai. Student profile ke Overview mein bhi "Brothers & sisters" ki list hai.
- **Category fees (A/B/C)**: Fee management -> **Category fees** tab. Har category ke liye rules add/edit/delete karein (percent off ya fixed Rs off, kisi ek head par ya tuition par). Naya admission ya category change hone par yeh discount student par khud lag jata hai aur har voucher mein nazar aata hai. Rule badalne ke baad "Apply to all existing students" dabayein. Hath se lagaye hue concessions mehfooz rehte hain.
- **Fee preview**: Admission form mein class + category chunte hi neeche us student ki monthly aur one-time fee dikhti hai.
- **Print**: "Save & print form" se admission ke baad foran form khulta hai (photo, details, category tick, siblings, fee table, declaration, signatures). Students list mein har student ke saamne "Form", aur upar "Print blank admission form" (hath se bharne ke liye).

## Recruitment: CV import, scoring, Email/SMS/WhatsApp, bank file

- **Bulk CV upload** (Recruitment → Candidates → Import CVs): PDF / DOCX / DOC files. Name, phone, email, qualification and years of experience are read automatically. Duplicates (same phone, email or CNIC) are caught and reported, not re-created. Scanned or picture-only CVs cannot be read; add those by hand.
- **Score out of 100** (40 keywords / 30 qualification / 30 experience). Set the words per job post ("Words to look for in CVs"). Candidate list can be filtered by keyword (inside the CV text), minimum score, and sorted by score. `POST /api/hr/recruit/rescore` recalculates.
- **Ad text and poster**: each job post has Poster (print, with logo), Copy ad text and Share on WhatsApp.
- **Interview marks sheets**: criteria are set in Recruitment → Email, SMS & marking. Each panel member gets a printable marks sheet; the average of all panel members is shown per candidate.
- **Hiring checklist**: documents checklist per candidate; Offer letter, then "Join as staff" creates the staff record and the appointment letter.
- **Email**: in Recruitment → Email, SMS & marking enter SMTP (Gmail: smtp.gmail.com, port 465 SSL, your Gmail address and a Google *App password*). Use "Send test" first.
- **SMS**: install an Android "SMS Gateway" app on a phone on the same network, enter its URL, path (default `/message`) and login. Use "Send test".
- **WhatsApp**: stays one-click: chats open one after another and you press Send in WhatsApp.
- **Bank file**: Payroll → Bank file (CSV) for an approved or paid month. Staff bank name and account number are visible only to pay roles.
- SMTP / SMS passwords are stored in the `settings` table of the database; protect the data folder.

## Families, sibling discount and tests

- **Family**: `students.family_id`. On the student profile the Family panel shows linked children (oldest = child 1), "same CNIC / phone" suggestions (Link / Link all) and "possible sibling - please confirm" (same father name and similar address; never linked automatically). Admin/office can remove a child from the family. A new admission with the same father CNIC or phone is linked automatically. API: `GET /api/students/:id/family`, `POST /api/students/:id/family/link {sibling_id}`, `POST .../family/accept`, `DELETE .../family`.
- **Sibling discount**: Fee management -> Category fees -> "Sibling discount (by child order)". Rule "3" also covers the 4th child onwards unless a higher number is set. Mode: *Highest only* (bigger of category and sibling discount) or *Stack* (category first, then sibling on what is left). After saving press "Apply to all existing students". The admission fee preview takes the order from the siblings found. API: `GET/PUT /api/fee/sibling-rules`.
- **Fix**: several concessions on one voucher now work one after another, so together they never take more than the fee (before, each was taken from the full fee).
- **Fix**: a student who moved section (or left) still shows earlier exams in his profile, worked out in the old section.
- **Tests**: `cd backend && npm test` (node:test via tsx). `siblings.test.ts`, `category.test.ts` need no server. `results.test.ts` starts the app on a random port and needs real Express.

## Smart CSV import (old website data)

Students page -> **Import CSV** (route `/import`, director / principal / admin).
- Upload any CSV (comma, semicolon or tab; UTF-8 or old Windows files). **Column names can differ in every file**: they are matched by name (`Student's Name`, `F/Name`, `GR No`, `Mobile No.` ...). Every match can be changed in the list before saving. The system also guesses whether the file holds students or staff (you can force it).
- Dates may be `15/03/2012`, `2012-03-15`, `5 Jan 2010` or Excel numbers; classes `6`, `6-A`, `Class Six B`, `10th`, `IX-C`; gender `M/F/Boy/Girl`; money `Rs 45,000`; status words like *left / withdrawn / struck off* make the student `left`.
- Nothing is written until **Save**. Preview shows how many rows will be saved, which already exist (skipped) and which have problems, with the reason per row.
- **Safe to repeat**: students are matched by admission no., or by name + father name + date of birth; staff by employee no., CNIC or name + phone. Existing rows are never changed or duplicated.
- Good rows are saved even if others fail; the rows that were not saved come back as a CSV with a "Why it was not saved" column.
- Missing admission nos. / roll nos. / employee nos. are given automatically. Missing classes and sections are created only if "Create missing classes and sections" is ticked.
- After saving students: brothers and sisters are linked from father CNIC / phone and category and sibling fees are applied.
- Not yet imported by this page: opening fee balances and old exam results (need the old file's columns first).

## Fixed fee per category, documents, reports, admission quality (B5 - B9)

- **Fixed fee per category** (Fee management -> Category fees -> "Fixed fee per category"): grid of class x head for each category A / B / C. Two ways, clearly different: *discount rules* take a percent / amount off the class fee; a *fixed fee* replaces the class fee of that head for that category (the category discount is then not applied to that head; sibling discount still can). Empty box = class fee + rules. `0` = free head. Table `fee_category_fees`; created empty, nothing existing is changed. API `GET/PUT /api/fee/category-fees`.
- **Category history**: `category_change_log` (old, new, who, when, reason). Written on admission, edit and bulk change. Shown on the student profile.
- **Documents**: B-form, birth certificate, father CNIC copy, last result card, plus KRL service card (category A) or pension proof (category B). JPG / PNG / PDF up to 4 MB, checked against the real file type, stored in the database. Each file has a "verified" flag. Missing documents show on the profile and on the printed admission form.
- **Bulk and reports** (Students -> Categories & reports): change category for a class / section (optionally only students with none), report of students by category and class, discount given per category, fee received per category (date range), CSV for the report and for the student list.
- **Admission** : father CNIC must be 13 digits (saved as 12345-1234567-1); a student with the same name + father name + date of birth gives a warning and asks before saving; admission number format e.g. `{CAMPUS}-{YY}-{CLASS}-{SEQ3}` (Students -> Categories & reports -> Admission settings, director / principal); optional first voucher (admission fee = one-time heads, plus first month) on save; QR code on the printed form (opens the student profile) and optional Urdu declaration. The QR code is made inside the program (no library); it was checked by decoding it with OpenCV for versions 1 to 10.
- **Speed and safety**: the students list no longer sends photos. Each avatar asks for its own photo (`GET /api/students/:id/photo`) only when it scrolls into view; the browser keeps it for an hour. Document and report endpoints are limited to office roles (reports also accountant).
- Admission settings for the first voucher: it uses the one-time fee heads, so mark the admission fee head as "one time" in Fee heads.

## Daily Diary & Homework

Menu: Academics > Daily Diary & Homework (`/diary`). Roles: director, principal, admin, teacher.

- **Class diary**: a teacher posts homework, classwork, test or notice entries for a section and date. A teacher can post only for sections they teach (timetable) or are class teacher of; managers can post anywhere. `Print this day` opens a one-page sheet with a parent signature line (`/diary/print`).
- **Teacher diary**: each teacher records what was taught (topic, plan for next lesson, remarks). Principal and director see all teachers and can mark a line reviewed with a remark.
- **Student notes**: short notes about one student (praise, concern, late, uniform, homework not done) with a "parent signed" checkbox.
- **Not written** (principal and director): sections and teachers who have lessons in the timetable that day but no diary entry. Holidays are not considered.

Assumptions made (change if wrong): a teacher can edit only their own entries; the principal reviews teacher diaries; parents do not log in, so "parent signed" is ticked by staff.

API: `/api/diary/scope`, `/class`, `/teacher`, `/teacher/:id/review`, `/students/:id/notes`, `/notes/:id/seen`, `/missing`. Tests: `backend/test/diary.test.ts`.

## Front Desk

Menu: Front Office > Front Desk (`/frontdesk`). Roles: director, principal, admin.

- **Visitors**: sign in (name, purpose, who they meet, badge), sign out later. Time out cannot be before time in. Only director/principal can delete a record.
- **Admission enquiries**: child, parent, phone (required), class, category A/B/C, source, status (new, contacted, visited, admitted, lost) and call-back date. Open enquiries whose call-back date is today or past are listed on top.
- **Gate passes**: the office requests an early leave for an active student; director/principal approve or reject (once); the gate marks "Student left" only on an approved pass, once.

Assumptions: teachers have no access; an enquiry is not automatically converted into a student (status is set by hand). API: `/api/frontdesk/visitors|enquiries|passes`. Tests: `backend/test/frontdesk.test.ts`.

## Parent Teacher Meeting (PTM)

Menu: Communication/Academics > Parent Teacher Meeting (`/ptm`). Office (director, principal, admin) plans meetings; class teachers work only on their own class.

- **Plan**: title, date, start time, minutes per parent, optional finish time (refused if the class does not fit), venue, the exam to discuss (optional), the attendance months, and the classes. Every active student gets a time in roll order, or failing/dropping students first. All classes run in parallel (each class teacher meets their own parents).
- **Per child (parent sheet)**: subject marks with class average and highest, total, grade, position, change since the previous exam, progress over the session, attendance by month with absent dates, teacher diary notes, and automatic talking points (failed subjects, fall or rise in marks, subject far below class average, low or excellent attendance, repeated lates). One A4 page with space for meeting notes and signatures. Print one child or the whole class.
- **Per class**: pass rate, average, highest/lowest, subject table with teacher, top 3, average attendance, students below the minimum (Attendance setting), per-student table. Printable.
- **Invitations**: message per parent with their time; WhatsApp and SMS links (Pakistani numbers normalised to 92...); marks "sent".
- **At the meeting**: mark met / did not come, who came, what was discussed, parent remarks, agreed action, follow-up date. This also updates the exam module's "parents to call" list (attended / no show, meeting date).
- Students who join a class after scheduling get the next free time ("Add students who joined later").

Attendance uses the same rules as the Attendance module (leave counts as in settings; month totals are used when no daily register exists). Tests: `backend/test/ptm.test.ts`.

## Communication (KMCB, KRL Model College for Boys)

College name is now **KRL Model College for Boys** (short name **KMCB**) by default, and every "GRL" in categories, documents and labels is now "KRL". Existing databases: a placeholder name is replaced on start and saved category labels containing GRL are updated.

Menu: Communication (`/communication`). Everyone on the staff can read; director, principal and admin write drafts; only director/principal publish or withdraw.

- **Kinds**: circular, meeting points (date, time, venue, who was present, points with who is responsible and by when), office order, date sheet, result notification, notice. Urgent flag.
- **Fill from exams**: a date sheet is filled from exam paper dates (rows of papers without a date are counted and reported); a result notice is filled with pass %, average and top student per class (classes with incomplete marks are skipped and reported).
- **Audience**: all staff, teachers only, parents of chosen classes, or staff and parents.
- **Life of a notice**: draft (office only, editable) > published (gets a reference like `KMCB/CIR/2026/001`, numbering per kind and year, never reused; cannot be edited) > withdrawn (stays on record). Published notices print on a letterhead page with signature and "Copy to".
- **Staff**: a NEW badge until they press "I have read this"; the office can see who has and has not read it.
- **Parents**: pick a class and send each parent a WhatsApp or SMS (father's number first); sent is tracked per student.

Tests: `backend/test/communication.test.ts`.

## Download Center

Menu: Download Center (`/downloads`). Staff only (parents do not log in; give them printed copies or use Communication).

- Categories: forms, date sheets, notes, syllabus, circulars, other; optional class and subject; search by title or subject.
- Allowed: PDF, JPG, PNG, Word, Excel, PowerPoint, up to 6 MB. The file content is checked against its type, so a renamed program is refused.
- Director, principal and admin upload anything; teachers upload **notes** only. Only the uploader or the office can edit or delete. Downloads are counted.
- Files are stored inside the database, so the daily database backup covers them.

## Tasks

Menu: Tasks (`/tasks`). All staff.

- The office (director, principal, admin) gives a task to any active staff member with due date and priority; everyone else adds tasks for themselves only.
- Assignee can start, finish (with a note) and comment; only the person who assigned (or the office) can edit, reassign, cancel, reopen or delete. Every change is kept in the task history.
- Lists: My tasks, Given by me, Everyone (office), Workload per person (open, overdue, done). Overdue tasks are marked red; the top cards show your open, overdue, due today and done counts.

Tests: `backend/test/downloads_tasks.test.ts`.

## Teacher portal and additional charges

**Removed**: all "Soon" placeholder modules (Complaints, Library, Point of Sale, Accounts, LMS, ...) are gone from the menu and from the code.

**Teacher menu** (a teacher sees only what is theirs): My Home (`/me`: classes and subjects, today's lessons, marks to enter, papers to submit, tasks, latest salary slip), My Timetable, My Syllabus, My Test Marks, My Salary Slips, My Files, Attendance / Diary / PTM (own class), My Papers to Set, Notices, Tasks, Download Center. Students, fee, HR (other than own slips), front desk, imports and the rest are hidden and also blocked by the server.

- **My Files** (`/files`): private locker for papers, marks files and notes (PDF, Word, Excel, PowerPoint, CSV, text, JPG, PNG, up to 10 MB). Only the owner and the principal/director can open a file. The content is checked against the type.
- **Marks from a file**: on any marks page, "Download class list" gives a CSV with Reg No, Roll No, Name, Marks, Status. Fill it in Excel and upload it back as CSV or **.xlsx** (old .xls is refused with instructions). Columns can be named Reg No / Roll No / Marks / Obtained / Status and so on. You see a preview first: numbers outside 0 to max, unknown students, duplicates and wrong statuses are listed per row and only the good rows are saved. A, AB, Absent, L or Leave mark absence or leave; blank rows keep what is saved. The usual locks (published exam, not your paper) still apply.

**Additional charges** (`/duties`, director, principal and admin): the office ticks charges for a teacher. The menu changes on the teacher's next page load; removing a charge removes the access at once (the server reads charges from the database on every request).
- **Exam Department**: full Examination office (create exams, assign papers, sheets, follow-ups) and **Paper Collection** (`/paper-setting`): ask teachers for papers per class and subject with a last date and instructions (can be filled from the exam plan), teacher uploads PDF/Word/image (new versions allowed), department approves or sends back with a remark, marks printed with copy count, reminds late teachers (a Task is created for them), prints the list. Printed requests stay on record.
- **Test Department** (`/test-dept`): per exam, who has entered marks and who has not (per paper and per teacher), reminder button, and the class marks list with totals and positions to print or download for Excel. Exam Department holders can use it too.
- **Timetable Team**: can generate and edit the timetable (all timetable tabs).

Tests: `backend/test/teacher_portal.test.ts` (duties, xlsx reader, marks file, files, paper flow, tracker, portal).


## System & Safety, parent messages, online results (new)
- **Backup & Restore** (Director/Principal): daily automatic backup, manual backup, download, restore (type RESTORE; a safety copy is made first). See `DEPLOY.md`.
- **Audit log**: every login and every successful change (who, when, which request); passwords and file contents are never stored. Search by action, person, date.
- **New session (promotion)**: preview per section, tick students to keep back, type PROMOTE. Top class becomes "passed out" (`left_reason`). Old results/fees stay. Exam session moves to the next year.
- **Teacher logins**: Additional Charges page lists teachers with/without a login and links an existing Teacher-role login.
- **Parent Messages**: absent-today and fee-reminder messages (also reachable from Fee → Defaulters → Send reminders). Preview, untick, send SMS through the SMS phone, or open WhatsApp chats. Every send is logged.
- **Urdu printing**: notice text and title are direction-detected per line (`dir="auto"`) with Nastaliq font fallbacks.
- **Online results**: `/result` for parents (off by default; switch in System & Safety).

## Sheets & Lists, phone use (new)
- **Sheets & Lists** page: blank *daily attendance sheet* (names + a column for every period + signature row), *award list* for one subject (roll, name, father, blank marks, signatures) and *whole-class award list* (a column per subject, total, %, position). Pick a class or one section; teachers can print for their own sections.
- **Class data download** (office): CSV with student details, parents' category (A/B/C with meaning), CNIC and phone numbers per class/section or all classes; each download is written to the audit log.
- **Phone / weak internet**: attendance and marks that fail to send are kept on the phone and sent automatically later (yellow bar). Installing as an app and offline opening need HTTPS (see DEPLOY.md section 9).

## ID & Transport (TPT) cards (new)
- Menu **ID & Transport Cards** (Director/Principal/Admin). Choose Student ID card or Transport card, a class/section (or search one student), press *Prepare cards*.
- Credit-card size (85.6 x 54 mm), ten per A4 page, with the student's photo, details, QR (admission no) on the ID card; the Transport card carries the "TPT" badge, route, stop, bus, pick/drop type, times, and the driver on the back.
- Both fronts have a signature box with the Principal's name for the check-and-sign. The Principal's name comes from the Principal login (or settings key `principal_name`).
- Print Front, turn the pages over, print Back (back order is mirrored). Students without a photo print a letter placeholder; add photos in the student profile. Every print is written to the audit log.

## Timetable: School wing and College wing, class teacher first, build by hand (new)
- **Two wings.** Timetable has a School / College switch. Each wing has its own days, number of periods, first bell, period length and break (Timetable → Days & periods), its own classes (same page: classes 11-12 start in the college wing, change it there), its own curriculum, auto-generation, publishing and editing. Publishing one wing never touches the other.
- **Shared teachers.** A teacher who teaches in both wings is never booked at overlapping clock times: the other wing's published lessons are treated as "not available" periods by clock overlap. Substitute suggestions also compare clock times. Personal "not available" periods you tick for a teacher are by period number and apply to both wings.
- **Class teacher's first period.** (Days & periods → checkbox, on by default.) The generator puts the class teacher's own lessons into period 1 of every day in his or her own class, as fixed (locked) lessons. If the curriculum gives the class teacher fewer lessons than there are days, the missing days are listed as warnings in the readiness check. Set class teachers in Attendance → Class teachers.
- **Build by hand.** Timetable → View & edit → Edit → *Build by hand*: tap any period of a section, pick the subject; subjects that would clash are greyed with the reason (teacher teaching elsewhere, not available, daily limit, no teacher assigned). Also *Clear this period*. Double-period subjects are placed by the generator.
- Period attendance and "My lessons" use the bell times of the section's own wing.

## Photo reading (new)
- **Marks from a photo**: on the marks-entry page, photograph the filled award list (printed from Sheets & Lists, so it has roll and admission numbers). The handwriting is read, shown row by row (editable), with warnings when the name does not fit the roll number or a mark is above the maximum. Save only after checking.
- **Admission form from a photo**: Students → New admission → *Fill from photo of filled form* fills the empty boxes; nothing is saved until Save.
- Needs internet and an API key (System & Safety → Photo reading, or the `ANTHROPIC_API_KEY` environment variable; optional `ERP_VISION_MODEL`). The photo is sent to the Claude API for reading; at most 40 photos per person per hour. Not tested against real handwriting; accuracy varies with the writing and the photo.
- Transport (TPT) and ID cards both carry a QR code (admission number).

## Timetable extras: quality, saved copies, substitutes, master sheet

All under **Timetable** (each wing separately).

- **Quality** – a 0–100 score with the counts behind it (teacher free gaps, 4-in-a-row runs, empty periods inside a class day, same subject back to back, heavy subjects late, periods not placed), teacher load table, section table, class-teacher-in-period-1 check, and a list of things to look at. The score is a rough guide for comparing two timetables, not a verdict.
- **Saved copies** – a copy of the timetable is kept automatically before every publish, clear and hand edit (newest 15 / 10 kept). You can save a named copy, restore any copy, and **Undo last hand edit**. A copy that no longer fits the current teachers/subjects asks for confirmation before restoring. Restoring first saves the current timetable.
- **Substitutes** – pick a date and the absent teacher; each of their lessons shows who is free at that clock time (subject teachers first, then whoever covered the fewest this month). Clashes are refused. Printable sheet with a signature column, plus a monthly "lessons covered" count for extra-duty allowance. Teachers can view; only the timetable team can assign.
- **Master sheet** – whole-wing timetable per day, by class or by teacher, printable on A4 landscape, and CSV download.

Not changed: the timetable solver itself. Quality numbers are there so you can judge it on your own data.

### Balance, science rule and substitute fairness

- **Science subjects**: tick "Science" on a subject (Physics, Chemistry, Biology and anything with "science" in its name are ticked automatically for existing data). The generator then avoids more than **2 science lessons in a row** in a class (a break ends a run). It is a strong preference, not an absolute rule: if the data leaves no other way, the Quality tab shows how many places break it.
- **Weekly load target** (Days & periods, default 24): Quality → *Balance and fairness* shows each teacher against the target, with average, lowest, highest and spread. The generator evens out each teacher's days; how many subjects/sections each teacher is given (Curriculum / auto-assign) decides the weekly total, so fix large gaps there.
- **Substitutes** never go to a teacher who is busy at that time, already has 6 lessons that day (or their own daily limit if lower), would exceed their weekly limit, or has covered twice in the Monday–Sunday week. A teacher who has covered once that week is offered only if nobody with no cover that week is free; choosing one anyway is refused.

## Motion and transitions (UI)

All in `frontend/src/styles.css` ("Motion layer"), so every page gets it without per-page changes: pages ease in with their blocks following one by one; sidebar items slide in, lift and show an active bar; buttons spring on press and the main button has a light sweep; inputs lift on focus; big cards lift on hover; table rows fade in in sequence; dialogs and toasts spring up; progress and fairness bars grow; the light/dark switch is a circular reveal from the button (browsers with View Transitions, otherwise a plain switch). Helper classes for pages: `skeleton` (loading shimmer), `pulse-ring`, `lift`. Everything is disabled for people who set "reduce motion" in their system and when printing. Not tested on a real browser here — check on a low-end phone and, if it feels heavy, delete the "Every routed page" block.

## Daily-work additions

- **Fee receipt QR**: every receipt prints a QR code. Scanning it opens `/verify/<code>` (no login): "Genuine receipt", "Cancelled receipt" or "Not verified", with name, class, amount and date only (no phone, CNIC or balance). The code is signed with a secret kept on the server (setting `receipt_secret`, made on first use), so a receipt cannot be invented or its amount changed. Keep that setting when you move the database; if it is lost, old QR codes stop verifying. The QR contains the address the receipt page was opened from, so open receipts from the same address parents will use (your public address, not a LAN IP).
- **Automatic fee reminders** (Parent Messages → top panel, director/principal): off by default; once a month on or after the chosen day (1-28), 10 am-6 pm server time, to parents who owe more than the chosen amount; never twice in a month; needs SMS set up. "Send this month's now" does the same on demand. All messages go in the parent message log. Env `NO_AUTOFEE=1` disables the timer.
- **Leave → replacement**: teachers away on a date (approved staff leave, or marked absent/leave in the staff register) are listed at the top of Timetable → Substitutes with how many lessons still have no cover; one click picks them, and "Cover all their lessons automatically" gives each lesson to the best free teacher under the same fairness rules (no one with 6 lessons that day, none over their weekly limit, at most 2 covers a week and a second only when nobody else is free). Lessons nobody can take are listed to do by hand.
- **Aaj ka kaam** (top of the Dashboard for director, principal, admin, accountant): lessons without a replacement, leave requests waiting, sections whose attendance is not taken, students owing fee, fee received today, exams within two weeks. The accountant sees the fee lines only. Each tile opens the page where it is dealt with.

## Timetable: compare, free periods, invigilation roster

- **Saved copies → Compare two copies**: pick two copies (or "Timetable now") and see, class by class, each period that changed (from → to), plus each teacher whose weekly load changed.
- **Free periods** (Timetable tab): per teacher and day, which periods are free; gaps between two lessons in bold; free periods per week; printable (landscape) and CSV. Use it to choose who gets extra duty.
- **Invigilation** (Examination → Invigilation): needs each paper to have a date. One or more invigilators per room (a room = a section writing on a date), shared so every teacher gets about the same number of duties. Never the teacher who set a paper for that room, never someone on approved leave or marked absent that day, and not two rooms on one day unless nobody else is free (marked "2nd room today"). Change any room by hand (📌 stays fixed when the roster is made again). Printable by date with a signature column, plus a per-teacher list. Teachers can see their own coming duties through the API `/api/exam-duty/mine`.

## Security additions

- **Two-step login (My Security page)**: authenticator app (Google/Microsoft Authenticator, Authy), 6-digit code every 30 s, works offline on the phone, 8 one-time recovery codes shown once. 5 wrong codes lock that person for 15 minutes; a code cannot be used twice. The director/principal can make it **compulsory for chosen roles**: such a person can do nothing else until it is set up (the server enforces this). A lost phone: director/principal presses "Reset" next to the name. Nothing is sent by SMS or e-mail. The phone's clock must be right.
- **Copy outside** (System & Safety): after every daily backup a second copy goes to a folder (USB, or one synced by Dropbox/OneDrive/Google Drive), a WebDAV address (Nextcloud, many NAS boxes), and/or an e-mail address. Copies are gzip + AES-256-GCM encrypted with the passphrase the director chooses (e-mail and WebDAV refuse to work without one). **A forgotten passphrase cannot be recovered.** Decrypt: `node scripts/decrypt-backup.mjs copy.db.enc restored.db` in the backend folder, then "Restore from a file…". E-mail copies are limited to 20 MB. The e-mail attachment code and the WebDAV upload are tested with stand-ins, not against a real mail server or cloud, so send a test ("Send the latest backup now") after setting them up and check it arrives.
- **Downloads report** (System & Safety): per person, rows read, exports/card prints, backup downloads, what they mostly opened, last time; "High" for far-above-normal readers or a non-director who downloaded a backup. It counts every answer of 100 rows or more (so it also catches a screen later saved as CSV), class exports, card prints and backup downloads. It cannot see what a person does with a file afterwards.

## Small additions

- Dashboard "Aaj ka kaam": staff leave and student leave requests are now two tiles, each opening its own page.
- Approving a staff leave now shows, right on the Leaves page, how many of that teacher's lessons (today onward, up to 30 days) have no replacement yet, with a button to the Substitutes page.

## Records, stock, notices and fee forecast

**Discipline & behaviour** (`/discipline`, and the *Behaviour* tab of every student profile)
- Teachers can add a *note* or a *praise* and see only their own entries. Director, principal and admin add *warnings*, *summons* and *suspensions* and see everything.
- A summon has the date the parents should come, can send an SMS to the father's number (falling back to mother, then student phone), and has a printable letter. The office marks it *parents came / did not come / new date*.
- Three warnings in the last 365 days with no summon since give a hint on the profile and a list on `/discipline`. Only director and principal can delete a record. Open summons show as a tile in "Aaj ka kaam".

**Inventory & lab equipment** (`/inventory`)
- Every item has good / damaged / lost / written-off counts. A count only changes through an entry (damaged, repaired, lost, written off, added), so the history explains the numbers and nothing can go below zero.
- Teachers can only *report damage* (a reason is required). The office manages the rest, prints the stock sheet, downloads CSV and prints the damage & loss report with its value.

**Notice board** (`/notices`)
- A notice is for staff, parents or both, with a start date, an end date and an optional pin. Staff see live notices on the dashboard / teacher home with a NEW badge; opening one marks it read, and the office sees "read by X of Y".
- For parents the SMS goes once per notice and once per phone number (a family with three children gets one SMS). Optional class filter.

**Fee forecast** (Fee → *Forecast*)
- Per class: for each of up to six earlier months, the share of dues that was paid that month (due = unpaid carry at the start + charges of the month). The middle share times what is due now is the expected collection; the worst and best months give the range. With no earlier month there is no number, and fewer than three months is marked low confidence. Generate the month's vouchers first, otherwise "due" is too low.

Tests: `test/discipline.test.ts`, `test/records.test.ts`.

## Admission forms (same as the printed KRL forms)

Students → *Blank form: School (VI-IX)* / *Blank form: College (HSSC)*, or *Admission form* on a student.
- **School form** (classes VI-IX): the front sheet with items 1 to 16, the office-use block and signatures, and the back sheet with the declarations. **College form** (HSSC): four pages - particulars, SSC / HSSC-I results and subject groups, declarations, recommendation/approval. The form is chosen from the student's class (11 and 12 = college) and can be switched on screen.
- Added to both, and marked as added: **Transport** (route, stop, pick/drop, fee) and **Category A / B / C**. A filled form shows the fee table of that student: the category's fee rates and discounts, the transport fee of the chosen route/stop/mode, monthly total, one-time charges and "payable at admission". A **blank** form can print a fee chart for a chosen class (A, B and C side by side, plus the transport routes).
- The extra particulars the paper form asks (religion, father's qualification, last school, health, SSC marks, subject group, office section...) are typed once in the panel above the form and saved with *Save details*; saving also writes category and bus to the student record, so the fee voucher follows the form. These details are visible to director, principal and admin only.
- The old Urdu declaration option is no longer printed, because the declarations are now the college's own text.

## College logo
The KRL Model College crest is the default logo (`backend/assets/logo.jpg`). On the next start of a database that has no logo it is put in automatically; a logo already uploaded, or one the director later removes, is left alone. It shows on the login page, the sidebar, every printed form, receipt, voucher, ID card, report, letter, diary, PTM and communication sheet, the receipt-check page, and as the app / browser icon (`frontend/public`). To change it use Profile → College details.

## Adding a student: school or college, and the better transport picker
- *Add student* first asks **School student** (classes VI to X) or **College student** (HSSC, XI and XII). The class list then shows only that wing, and **Save & open admission form** opens the matching form (school form or HSSC form) with the details panel to finish it.
- The **transport picker** (add / edit student and the admission form) shows for each route its monthly fee and the seats left (or FULL), for each stop its pick-up time and any different fee, and for each mode (pick and drop / pick up only / drop only) its own fee. Below it: the monthly fee, "Picked up at ... dropped at ...", and an amber warning when the bus is already full (the student can still be added). The pick-up and drop times are also printed under the transport line of both forms.

## Registration form (all students)
A third printable form, the one-sheet **Registration form for every student, school or college** (Note, particulars of student / parents / brothers and sisters, and the office block with the Urdu / English / Maths / Science / Total result table, retest, remarks and granted / not granted / recommended). Switch to it with the *Registration form (VI - IX)* button on any student's form, or use *Blank: Registration (VI-IX)* on the Students page. The date of birth is also printed **in words** automatically. New fields (blood group, class to be admitted, official address, reported for test, results, retest, remarks) are in the details panel under *Registration form only*. Category prints in the header; this form has no transport or fee block, as on the paper.

## Filling a form in the order of the paper form
*Add student* now asks which form: **School · Application form**, **School · Registration form** or **College · HSSC form**, and opens that form on its own screen (`/students/form/new`). Above the form there is one panel that follows the paper form item by item (for the application form: top of the form, 1 to 5 student, 6 to 8 father, 9 to 11 addresses and telephone, 12 to 16, 17 transport, office use; the registration and HSSC forms have their own numbering). Everything typed is written on the form below it at once - name, date of birth (and the date in words), addresses, phones, category, class, transport, fee - and **Save student** creates the student record and the form particulars together, after which the same screen shows the saved form with its registration number, ready to **Print**. For an existing student the same panel opens from *Admission form* and saves with *Save details*. Brothers and sisters are found from the father's CNIC / phone (they are written on the form and the family discount shows in the fee). The old quick-edit window (pencil icon) is still there for small corrections.

## Form print settings
On the admission / registration / college form page, the "Print settings" panel sets paper size (A4, Letter, Legal, A5), orientation (portrait/landscape), the four page margins (mm) and a scale (%). The form width follows the printable area and the `@page` rule is rewritten live. Settings are remembered per browser (localStorage). In the browser print dialog keep Margins "Default" and Scale 100%.

## Form entry fixes
- CNIC (`12345-1234567-1`) and phone (`0300-1234567`, `+92` becomes `0`) are formatted while typing in the form entry panel and in the student quick-edit. Stored data is unchanged in meaning: the backend always compares digits only.
- On wide screens (1280px+) the entry panel sits on the left and the form preview on the right, so typing and the form are visible together. On smaller screens, choosing a form type scrolls to the preview.
- Photo: choosing a picture opens an adjust window (drag to move, slider to zoom). It is saved at the passport shape (4:5) used by the forms and ID cards.
- QR codes: centred between the signatures on the application and registration forms, top-right beside the photo on ID cards, fixed square on receipts.

## Pick-lists in the form entry panel
Fields that are usually one of a few answers (religion, medium, previous class, blood group, qualification, BPS, income, months, scholarship, co-curricular interests, games and hobbies, health status, future plan, session, exam board) are drop-downs with an "Other (type it)" choice. The lists are in `PICKS` / `BOARDS` in `form-entries.ts`; edit them there. Each field takes one choice; use "Other" to type several.

## Roles and access
| Role | Access |
|---|---|
| Principal, Admin (and Director) | Everything: all modules, System & Safety, backup, audit, payroll, approvals. A route open to the principal is automatically open to the admin (`FULL` and `expand` in `backend/src/auth.ts`, the same list in `core/auth.ts` for the menu). |
| Accountant | Fee, payments, vouchers, forecast, transport fee, payroll, parent messages (not absent notices), notices, tasks, downloads, own security. Opens on the Fee page. Cannot open the dashboard, admissions or exams. |
| Teacher | Own home, attendance of own classes, diary, marks, papers to set, syllabus, timetable view, own salary slips, damage reports, notes. Student lists show no father CNIC or P. No. No family or sibling lookup. Extra pages only through an additional charge (exam, test, timetable team). |

The server enforces this on every request; hiding a menu item is only for convenience. To take full access away from the Director or Admin, edit `FULL` in `backend/src/auth.ts` and `isLeadership` / `canSystem` / `canWriteStudents` in `frontend/src/app/core/auth.ts`.

## College Profile (director, principal, admin)
Menu: College Profile. One place for the college name, short name, address, phone, email, website, motto, affiliation, year established, logo and campus picture, plus the office bearers (director, principal, vice principal, headmaster, accounts officer, HR officer, admin officer) with photo and contact. The names are read everywhere they are printed: signature lines on fee, exam, HR, attendance and transport prints, and the principal's name on ID cards. Change it once and every print follows.
The same page holds the "Teachers may work across classes" switch (default on): any teacher may then mark attendance, enter marks, and make and download their own paper for any class or subject. Class-teacher duties (class sheet, class result, PTM) stay with the class teacher.

## Teachers (director, principal, admin)
Menu: Teachers. Add, edit and remove teachers with rank (Educator, Senior Educator, Subject Specialist, Senior Subject Specialist, Lecturer, Assistant Professor, Associate Professor, Professor), subjects, photo, CNIC, phone, qualification. "Login and password" creates a login, renames it, resets the password (8+ characters, shown once) or switches it off. A switched-off login stops working at once. The dashboard shows teacher counts by rank.
Removing a teacher who still has lessons or a class asks for confirmation and frees those lessons.

## Notices and circulars
Principal, director and admin can edit and delete a circular in any status; changes to published ones are written to the audit log.

## Database integrity (System & Safety, Data check)
- Every pointer between tables is protected. Columns that were added later and carry no FOREIGN KEY (class teacher, bus route and stop, voucher and payment links, HR links, substitutions and so on) get the same protection from database triggers installed at every start: a row cannot point at something that does not exist, and deleting a teacher, route, subject or user clears or removes what depended on it. Vouchers and payments cannot be deleted while the ledger uses them.
- One person, one record: a username cannot repeat in another letter case, one login serves one teacher, an HR file links to one teacher, and the director, principal, vice principal and headmaster appear once in the College Profile.
- A teacher's details live in the Teachers module; the HR file and the login mirror them. The Data check reports any copy that drifted and "Fix automatically" copies it back. Money (voucher lines, ledger, receipts) is checked but never changed automatically.
- Run it from System & Safety, Data check, or call `GET /api/integrity` and `POST /api/integrity/repair`.

## Demo data
`npm run seed:demo` fills every module (Aug to Nov 2026): students, timetable, fees (Aug to Nov), attendance, exams, syllabus, transport, HR, plus College Profile with seven office bearers, teachers with ranks and a login each (password `Teacher@123`, username is the first name, for example `ali.satti`), front desk visitors, enquiries and passes, a parent teacher meeting, circulars, notices, tasks, discipline records, inventory and diary. The seed ends by running the Data check and prints the result. Other logins use `ChangeMe@123`. Change all passwords before real use.

## Passes, meetings, sessions
A waiting gate pass can be changed; the principal or director can delete a pass (logged). A parent teacher meeting's title, date and venue can be changed. Resetting a teacher's password ends every session that teacher had open.

## Discipline letters
In a student's Behaviour tab, every record (note, praise, warning, summon, suspension) has "Issue a letter". The text is filled from the record (warning, summon, suspension, appreciation or general) and can be edited before it is issued. An issued letter gets a number (`KMCB/DIS/2026/001`), is stored exactly as printed, and can be printed again. The student's record shows how many letters have been issued, by type, with the full list below. Only the principal, director or admin issue letters; a letter stays on record even if the original record is deleted.

## Photos and QR on cards
A student without a photo shows a boy or girl picture (by the gender on the record) on ID and transport cards, the student profile and student lists, the attendance, fee and PTM pages of one student, and the printed result cards, progress reports and certificates. The pictures are `frontend/public/avatars/boy.svg` and `girl.svg`; replace them with your own if you like. The QR on the cards now fills its box (15 mm) and scans the admission number.

## Database design (relationships, keys, indexes)
- **Real foreign keys everywhere.** At every start `upgradeDatabase()` brings an older database up to date: columns that only pointed at another table (class teacher, bus route and stop, voucher and payment links, HR links, substitutions, student family and so on) are rebuilt as real FOREIGN KEYs with the right action (clear the pointer, delete the dependants, or refuse). It runs inside a transaction and leaves a table alone if existing data would break the rule, listing it for the Data check. Back up before the first start of a new version.
- **Families are a table** (`families`); a student's `family_id` points at it, and an empty family is removed automatically.
- **Indexes.** Every foreign key column starts an index, plus indexes for what the screens filter and join on (students by section and status, vouchers by student and period, payments, marks, audit log, letters, passes and so on). An index that only repeats the start of a longer one is dropped. Statistics are refreshed (`ANALYZE`, `PRAGMA optimize`) so SQLite uses them.
- **One source for each fact.** College Profile holds the names of the director, principal and officers, and their logins follow. A teacher's details live in Teachers; the HR file and login mirror them. Vouchers keep gross, discount and net as a snapshot of what was issued, and the Data check proves they equal the lines and the ledger.
- Not possible as a foreign key: the audit log's and HR files' "belongs to" columns point at many different tables, so they are indexed and checked instead.

## QR codes, offline, demo hosting
The QR on ID and transport cards opens `<address>/scan/<admission no>` (the student's profile after login); the address is set in College Profile. Fee receipt and admission form QR codes use the same address. See DEPLOY.md sections 10 and 11 for offline use on the college network, the `Dockerfile`, `DEMO_SEED=1` and `demo-online.bat`.

## Global search
A search box at the top of the principal's, teacher's and accountant's home page (press `/` anywhere to jump to it). It finds students (name, father's name, admission number, roll number, phone, CNIC), teachers (name, subject, phone, CNIC, username), other staff, fee vouchers and receipts, notices and circulars, and admission enquiries. Phone numbers match with or without dashes and spaces. Arrow keys and Enter, or the mouse, open the hit. What a person finds follows what they may see: a teacher finds students and published notices only; the accountant also finds fee papers; the office finds everything.

## Real students (KMCB, classes XI and XII)
- `backend/src/data/realStudents.ts` holds the college's own list (246 students: admission number, name, father, class and section, category A/B/C), made from `Test_Attendence_2026.xlsx`. The same list is in `samples/kmcb-students-2026.csv`.
- **Demo / seed data**: classes 6 to 10 are invented demo students; classes XI and XII are the real students. The real ones get no invented phone numbers, and keep the category from the list (6 have none yet: set it under Students).
- **Actual database**: Data import page > "KMCB students, classes XI and XII" (preview, then Add), or `cd backend && npm run import:real` (`-- --dry` only shows what would happen). Matching is by admission number, so existing students are never changed and running it twice adds nothing. Take a backup first.
- Not imported: the 25 names at the bottom of the sheet (no valid admission number, and several are already in the XI lists). They are in `samples/kmcb-pending-no-admission-no.csv` for the office to check.
- Checks the sheet could not settle: names/fathers with remarks (H-4011 "Accou", H-4014 "...Account Office", H-4053 father "jss") were kept as written. Edit them under Students.
# college-erp
