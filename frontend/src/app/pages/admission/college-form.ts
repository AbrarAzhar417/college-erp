import { Component, inject, input } from '@angular/core';
import { SettingsService } from '../../core/settings';
import { FormFeeBox } from './fee-box';
import { FORM_CSS, FormView, GROUPS, cnicCells } from './form-data';

/** KRL Model College for Boys, Kahuta - application form for admission in HSSC (four pages), with category and transport fee. */
@Component({
  selector: 'app-college-form',
  imports: [FormFeeBox],
  styles: [FORM_CSS],
  template: `
  <section class="pg sol" aria-label="HSSC admission form, page 1">
    <div style="display:flex;justify-content:space-between">
      <div class="logo" style="margin:0;width:34mm">@if (cfg.logoUrl()) { <img [src]="cfg.logoUrl()" alt=""> } @else { <span>{{ cfg.initial() }}</span> }</div>
      <div style="width:76mm"><div class="f"><span class="q">Registration No.</span><span class="ln">{{ v().regNo }}</span></div><div class="f"><span class="q">Category: (Admission)</span><span class="ln">{{ v().category }}</span></div><div class="f"><span class="q">Category: (Fee/Funds)</span><span class="ln">{{ v().category }}</span></div>
        <div class="small">A: father in KRL service · B: KRL retired · C: private job</div></div>
    </div>
    <div class="cen" style="margin-top:6mm"><p class="t1" style="font-size:16pt">{{ cfg.instituteName() }}</p><p class="t2" style="margin-top:2mm">Application Form for Admission in HSSC</p></div>
    <div class="f bold" style="margin-top:6mm"><span class="q">CLASS:</span><span class="ln">{{ v().className }}</span><span class="q">SESSION:</span><span class="ln">{{ v().session }}</span><span class="q">SUBJECT GROUP:</span><span class="ln" style="flex:1.6">{{ v().group }}</span></div>

    <p class="bold u" style="margin:6mm 0 0"><span style="display:inline-block;width:10mm;text-decoration:none">1.</span>PARTICULARS OF STUDENT:</p>
    <div style="display:flex;gap:4mm"><div style="flex:1">
      <div class="f"><span class="n">i.</span><span class="q">Name (Block Letters):</span><span class="ln">{{ v().name }}</span></div>
      <div class="f"><span class="n">ii.</span><span class="q">Date of Birth:</span><span class="ln">{{ v().dob }}</span></div>
      <div class="f"><span class="n">iii.</span><span class="q">Place of Birth:</span><span class="ln">{{ v().pob }}</span></div>
      <div class="f"><span class="n">iv.</span><span class="q">Religion:</span><span class="ln">{{ v().religion }}</span></div>
      <div class="f"><span class="n">v.</span><span class="q">Nationality:</span><span class="ln">{{ v().nationality }}</span></div>
    </div>
    @if (v().photo) { <img class="photo" [src]="v().photo!" alt=""> } @else { <div class="photo">Recent Passport Size<br>Photograph</div> }</div>
    <div class="f"><span class="n">vi.</span><span class="q">School/College last attended:</span><span class="ln">{{ v().prevSchool }}</span></div>
    <div class="f"><span class="n">vii.</span><span class="q">Class last attended/Medium of instruction:</span><span class="ln">{{ join([v().prevClass, v().medium], ' / ') }}</span></div>
    <div class="f"><span class="n">viii.</span><span class="q">CNIC / 'B' Form No:</span><span class="bxs">@for (c of cells(v().bform); track $index) { <span class="bx">{{ c }}</span> }</span></div>

    <p class="bold u" style="margin:6mm 0 0"><span style="display:inline-block;width:10mm;text-decoration:none">2.</span>PARTICULARS OF PARENTS/GUARDIAN:</p>
    <div class="f"><span class="n">i.</span><span class="q">Father's/Guardian's Name (Block Letters):</span><span class="ln">{{ v().father }}</span></div>
    <div class="g2"><div class="f"><span class="n">ii.</span><span class="q">P. No.</span><span class="ln">{{ v().pno }}</span></div><div class="f"><span class="q">iii. Occupation/Designation:</span><span class="ln">{{ v().fatherDesig }}</span></div></div>
    <div class="f"><span class="n">iv.</span><span class="q">Division:</span><span class="ln" style="max-width:55mm">{{ v().fatherDiv }}</span><span class="q">v. CNIC No.</span><span class="bxs">@for (c of cells(v().cnic); track $index) { <span class="bx">{{ c }}</span> }</span></div>
    <div class="g2"><div class="f"><span class="n">vi.</span><span class="q">Qualification:</span><span class="ln">{{ v().fatherQual }}</span></div><div class="f"><span class="q">vii. Monthly Income with BPS/SPS:</span><span class="ln">{{ join([v().income, v().spsBps], ' / ') }}</span></div></div>
    <div class="f"><span class="n">viii.</span><span class="q">Phone No. off:</span><span class="ln">{{ v().telOffice }}</span><span class="q">Res:</span><span class="ln">{{ v().telRes }}</span><span class="q">Cell:</span><span class="ln">{{ v().cell }}</span></div>
    <div class="f"><span class="n">3.</span><span class="q">Present Home Address:</span><span class="ln">{{ v().address }}</span></div><div class="f"><span class="n"></span><span class="ln"></span></div>
    <div class="f"><span class="n">4.</span><span class="q">Permanent Home Address:</span><span class="ln">{{ v().permanent }}</span></div><div class="f"><span class="n"></span><span class="ln"></span></div>
  </section>

  <section class="pg sol" aria-label="HSSC admission form, page 2">
    <div class="f"><span class="n">5.</span><span class="ln" style="border:0"></span></div>
    <table class="tb" style="margin-bottom:5mm"><thead><tr><th>Exam Passed</th><th>Year</th><th>Roll No</th><th>Marks Obtained</th><th>Total Marks</th><th>Grade/Div/ %age</th><th>Subjects</th><th>Board</th></tr></thead><tbody>
      <tr style="height:9mm"><th>SSC</th><td>{{ v().ssc.year }}</td><td>{{ v().ssc.roll }}</td><td>{{ v().ssc.marks }}</td><td>{{ v().ssc.total }}</td><td>{{ v().ssc.grade }}</td><td>{{ v().ssc.subjects }}</td><td>{{ v().ssc.board }}</td></tr>
      <tr style="height:9mm"><th>HSSC-I</th><td>{{ v().hssc1.year }}</td><td>{{ v().hssc1.roll }}</td><td>{{ v().hssc1.marks }}</td><td>{{ v().hssc1.total }}</td><td>{{ v().hssc1.grade }}</td><td>{{ v().hssc1.subjects }}</td><td>{{ v().hssc1.board }}</td></tr></tbody></table>

    <p class="bold u" style="margin:4mm 0 1mm"><span style="display:inline-block;width:10mm;text-decoration:none">6.</span>Subjects of Studies for the HSSC Classes:</p>
    <div class="sub">(a) Compulsory: English, Urdu, Islamic Education (HSSC-I), Pakistan Studies (HSSC-II)</div>
    <div class="sub" style="margin-top:1mm">(b) Elective subjects (Select one of these Groups)</div>
    <table style="margin-left:14mm;border-collapse:collapse;font-size:9.5pt">
      <tr><td style="width:6mm"><span class="tick">{{ pick('Pre Medical') }}</span></td><td style="width:38mm" class="bold">Pre Medical</td><td>Physics, Chemistry, Biology</td></tr>
      <tr><td><span class="tick">{{ pick('Pre-Engineering') }}</span></td><td class="bold">Pre-Engineering</td><td>Physics, Chemistry, Mathematics</td></tr>
      <tr><td><span class="tick">{{ pick('Sc. General') }}</span></td><td class="bold">Sc. General</td><td>Physics, Mathematics, Computer Science</td></tr>
      <tr><td><span class="tick">{{ pick('Humanities (a)') }}</span></td><td class="bold">Humanities</td><td>a. Statistics, Isl. Studies, Economics</td></tr>
      <tr><td><span class="tick">{{ pick('Humanities (b)') }}</span></td><td></td><td>b. Fine Arts, Isl. Studies, Outlines of Home Economics</td></tr>
      <tr><td><span class="tick">{{ pick('Commerce') }}</span></td><td class="bold">Commerce</td><td>Accounting, Commerce, Economics, Business Math</td></tr>
    </table>
    <div class="f" style="margin-top:4mm"><span class="n">7.</span><span class="q">Interest in co-curricular/literary activities, if any:</span><span class="ln">{{ v().cocurricular }}</span></div>
    <div class="f"><span class="n">8.</span><span class="q">Participation in games/sports/hobbies, if any:</span><span class="ln">{{ v().sports }}</span></div>
    <div class="f"><span class="n">9.</span><span class="q">Distinction/Scholarship won in studies (if any):</span><span class="ln">{{ v().distinction }}</span></div>
    <div class="f"><span class="n">10.</span><span class="q">Have you ever suffered from any serious health/medical problem:</span><span class="ln">{{ v().health }}</span><span class="q">(Yes/No)</span></div>
    <p class="small" style="margin:1mm 0 0 8mm;color:#000;font-size:9pt">Information under Para-10 above is required for your due care only. In case of <b>Yes</b>, give the following details:</p>
    <div class="f sub"><span class="q">i. Name of the disease</span><span class="ln">{{ v().disease }}</span></div>
    <div class="f sub"><span class="q">ii. Name of the doctor/hospital</span><span class="ln">{{ v().doctor }}</span></div>
    <div class="f sub"><span class="q">iii. Present status of the disease</span><span class="ln">{{ v().diseaseStatus }}</span><span class="q">(cured/being cured)</span></div>
    <div class="f"><span class="n">11.</span><span class="q">What do you plan to be in future?</span><span class="ln">{{ v().future }}</span></div>
    <p class="bold u" style="margin:3mm 0 0"><span style="display:inline-block;width:10mm;text-decoration:none">12.</span>Particulars of Brothers/Sisters <span style="text-decoration:none;font-weight:700">(If studying in KMC):</span></p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 10mm;margin-left:10mm"><b class="u">Name</b><b class="u">Class and Session</b>
      @for (s of sibs(); track $index) { <div class="f"><span class="q">{{ roman[$index] }}</span><span class="ln">{{ s.name }}</span></div><div class="f"><span class="ln">{{ s.class_session }}</span></div> }</div>
    <div class="f" style="margin-top:3mm"><span class="n">13.</span><span class="q">Transport required:</span>
      <span><span class="tick">{{ v().transport.need ? '' : '✓' }}</span>No <span class="tick">{{ v().transport.need ? '✓' : '' }}</span>Yes</span>
      <span class="q">Route / stop:</span><span class="ln">{{ v().transport.need ? v().transport.route + (v().transport.stop ? ' / ' + v().transport.stop : '') : '' }}</span></div>
    <div class="f"><span class="n"></span>
      <span><span class="tick">{{ v().transport.need && v().transport.mode === 'both' ? '✓' : '' }}</span>Pick and drop <span class="tick">{{ v().transport.need && v().transport.mode === 'pickup' ? '✓' : '' }}</span>Pick up only <span class="tick">{{ v().transport.need && v().transport.mode === 'drop' ? '✓' : '' }}</span>Drop only</span>
      <span class="q">Transport fee Rs</span><span class="ln" style="max-width:34mm">{{ v().transport.need && v().filled ? v().transport.fee : '' }}</span></div>
    @if (v().transport.need && v().transport.times) { <div class="small" style="margin-left:8mm">{{ v().transport.times }}</div> }
  </section>

  <section class="pg" aria-label="HSSC admission form, page 3">
    <h3 class="cen t2" style="margin-top:4mm">DECLARATION OF STUDENT</h3>
    <ol class="dec">
      <li>I understand that admission in KRL Model College is a privilege and in case of my selection as a student, I accept to abide by the rules and regulations of the College.</li>
      <li>I shall be punctual and regular in attendance and give all tests / examinations taken from time to time during my stay in the college.</li>
      <li>I clearly understand that if my results in the test / examination are not satisfactory or if I fall short of the required percentage of attendance, or if I become a habitual defaulter in respect of payment of College dues, or if I indulge in an act of indiscipline, the Principal has the power to remove my name from the rolls of the college and may not readmit me.</li>
      <li>I accept the discretion of the Principal to detain me before or at the time of the Board Exams, if I do not fulfill the requirements of the Board and of the College.</li>
      <li>I shall faithfully abide by the College rules for discipline and shall under all circumstances act in a manner which upholds the dignity and traditions of KRL Model College. I further declare that I shall never indulge in unhealthy activities during my stay in the College.</li>
      <li>I agree to accept as binding the decision of the Principal in all matters of the College.</li>
      <li>I hereby certify that the above information is correct to the best of my knowledge.</li>
    </ol>
    <div class="sig" style="margin-top:12mm"><span class="bold">Dated: ______________</span><div>Signatures of Student</div></div>
    <h3 class="cen t2" style="margin-top:12mm">DECLARATION OF PARENT</h3>
    <ol class="dec">
      <li>I hereby affirm that my son/daughter/ward is our mutual responsibility and I solemnly assure the Principal that I shall remain in constant contact with regard to the academic progress and behavior of my son/daughter/ward.</li>
      <li>I understand that my inability to attend the College, as and when required, will authorize the Principal to take an ex-parte decision in respect of my son/daughter/ward and that it shall be binding on me under all circumstances.</li>
      <li>I understand that the college authorities won't be held responsible for any unforeseen mishap/casualty during the college hours, official excursions and sports, etc.</li>
    </ol>
    <div class="sig" style="margin-top:12mm"><span class="bold">Dated: ______________</span><div>Signature of Parent</div></div>
    <h3 class="cen t2" style="margin-top:12mm">GENERAL INSTRUCTIONS</h3>
    <p style="margin:3mm 0 1mm 6mm">Please attach the following documents with this form:</p>
    <ol type="i" style="margin:0;padding-left:16mm"><li>06 recent photographs (03 passport size &amp; 03 1" x 1" size) of the student</li><li>School / College Leaving Certificate and Character Certificate issued by the Institution last attended.</li><li>Result card/Marks sheet issued by the Board/Institution last attended.</li><li>Attested copy of valid CNIC of Father/Guardian.</li><li>Attested copy of CNIC / 'B' Form of student.</li></ol>
  </section>

  <section class="pg sol" aria-label="HSSC admission form, page 4">
    <h3 class="cen t2" style="margin-top:4mm">RECOMMENDATION/APPROVAL</h3>
    <p class="cen" style="margin:6mm 0"><span [class.sel]="v().decision === 'granted'">Admission Granted</span> / <span [class.sel]="v().decision === 'not_granted'">Admission Not Granted</span></p>
    <div style="display:flex;justify-content:space-between;align-items:flex-end"><div class="f" style="width:60mm"><span class="q bold">Dated:</span><span class="ln">{{ v().decisionDate }}</span></div><div class="bold" style="border-top:.3mm solid #000;padding-top:1mm;min-width:60mm;text-align:right">PRINCIPAL</div></div>
    <h3 class="cen t2" style="margin-top:8mm">FOR OFFICE USE ONLY</h3>
    <div class="f"><span class="n">1.</span><span class="q">Admission test / interview held on</span><span class="ln">{{ v().testDate }}</span></div>
    <div class="f"><span class="n"></span><span class="q">Student Name:</span><span class="ln">{{ v().filled ? v().name : '' }}</span></div>
    <div class="f"><span class="n"></span><span class="q">Class:</span><span class="ln">{{ v().filled ? v().className : '' }}</span><span class="q">Section:</span><span class="ln">{{ v().section }}</span><span class="q">House:</span><span class="ln">{{ v().house }}</span></div>
    <div class="f"><span class="n"></span><span class="q">Admission No.</span><span class="ln">{{ v().admissionNo }}</span><span class="q">Dated:</span><span class="ln">{{ v().admissionDate }}</span></div>
    <div class="f"><span class="n"></span><span class="q">Sign of Office Asstt.:</span><span class="ln" style="max-width:90mm"></span></div>
    <div class="f"><span class="n">2.</span><span class="q">Total Amount received:</span><span class="ln">{{ v().feeReceived }}</span><span class="q">Receipt No.</span><span class="ln">{{ v().receiptNo }}</span><span class="q">Date:</span><span class="ln">{{ v().receiptDate }}</span></div>
    <div class="f"><span class="n"></span><span class="q">Sign of Accountant:</span><span class="ln" style="max-width:90mm"></span></div>
    <app-form-fee-box [fee]="v().fee" [chart]="v().chart" [tr]="v().transport" />
    <div class="f"><span class="n">3.</span><span class="q">Signature of Class Teacher:</span><span class="ln" style="max-width:100mm"></span></div>
    <div class="f"><span class="n">4.</span><span class="q">Signature of Vice Principal/In-charge:</span><span class="ln" style="max-width:100mm"></span></div>
    @if (v().missing.length) { <p class="small"><b>Documents still missing:</b> {{ v().missing.join(', ') }}</p> }
    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:10mm">
      @if (v().qr; as q) { <div class="qr" style="margin:0" [innerHTML]="q" title="Scan to open the student profile"></div> } @else { <span></span> }
      <div class="bold" style="border-top:.3mm solid #000;padding-top:1mm;min-width:60mm;text-align:center">Signature of Principal</div></div>
  </section>
  `
})
export class CollegeForm {
  v = input.required<FormView>(); cfg = inject(SettingsService);
  cells = cnicCells; roman = ['i.', 'ii.', 'iii.', 'iv.']; groups = GROUPS;
  join = (a: string[], sep = ', ') => a.filter(Boolean).join(sep);
  pick = (g: string) => (this.v().group === g ? '✓' : '');
  sibs = () => { const l = [...this.v().siblings]; while (l.length < 4) l.push({ name: '', class_session: '' }); return l.slice(0, 4); };
}
