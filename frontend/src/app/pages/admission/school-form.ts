import { Component, inject, input } from '@angular/core';
import { SettingsService } from '../../core/settings';
import { FormFeeBox } from './fee-box';
import { FORM_CSS, FormView, MODE_LABEL } from './form-data';

/** KRL Model College for Boys - application form for admission to classes VI to IX (front and back), with category and transport fee. */
@Component({
  selector: 'app-school-form',
  imports: [FormFeeBox],
  styles: [FORM_CSS],
  template: `
  <section class="pg" aria-label="School admission form, front">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div style="width:62mm"><div class="f"><span class="q">Registration No</span><span class="ln">{{ v().regNo }}</span></div><div class="f"><span class="q">Date of Issue</span><span class="ln">{{ v().issueDate }}</span></div></div>
      <div class="logo">@if (cfg.logoUrl()) { <img [src]="cfg.logoUrl()" alt=""> } @else { <span>{{ cfg.initial() }}</span> }</div>
      <div style="width:62mm"><div class="f"><span class="q">Category</span><span class="ln">{{ v().category }}</span></div>
        <div class="small" style="text-align:right">A: father in KRL service · B: KRL retired · C: private job</div></div>
    </div>
    <div class="cen" style="margin-top:1mm"><p class="t1">{{ cfg.instituteName() }}</p>
      <p class="t2">APPLICATION FORM FOR ADMISSION TO CLASSES VI - IX</p><p class="t3">(Please read the instructions carefully given over-leaf)</p></div>
    <div class="cen bold" style="margin:2mm 0 1mm;display:flex;justify-content:center;gap:8mm"><span>Class <span class="u" style="display:inline-block;min-width:32mm">{{ v().className }}</span></span><span>Session <span class="u" style="display:inline-block;min-width:32mm">{{ v().session }}</span></span></div>

    <div class="f"><span class="n">1.</span><span class="q">Student's Name (Block Letters):</span><span class="ln">{{ v().name }}</span></div>
    <div class="g2"><div class="f"><span class="n">2.</span><span class="q">Date of Birth:</span><span class="ln">{{ v().dob }}</span></div><div class="f"><span class="n">3.</span><span class="q">Place of Birth:</span><span class="ln">{{ v().pob }}</span></div></div>
    <div class="g2"><div class="f"><span class="n">4.</span><span class="q">Religion:</span><span class="ln">{{ v().religion }}</span></div><div class="f"><span class="n">5.</span><span class="q">Nationality:</span><span class="ln">{{ v().nationality }}</span></div></div>
    <div class="f"><span class="n">6.</span><span class="q">Father's Name:</span><span class="ln">{{ v().father }}</span></div>
    <div class="f"><span class="n">7.</span><span class="q">Father's Qualification &amp; Designation / Division:</span><span class="ln">{{ join([v().fatherQual, v().fatherDesig, v().fatherDiv]) }}</span></div>
    <div class="f"><span class="n">8.</span><span class="q">CNIC No:</span><span class="ln">{{ v().cnic }}</span><span class="q">P.No</span><span class="ln" style="flex:.6">{{ v().pno }}</span><span class="q">SPS/BPS</span><span class="ln" style="flex:.5">{{ v().spsBps }}</span></div>
    <div class="f"><span class="n">9.</span><span class="q">Residential Address:</span><span class="ln">{{ v().address }}</span></div><div class="f"><span class="n"></span><span class="ln"></span></div>
    <div class="f"><span class="n">10.</span><span class="q">Permanent Address:</span><span class="ln">{{ v().permanent }}</span></div><div class="f"><span class="n"></span><span class="ln"></span></div>
    <div class="f"><span class="n">11.</span><span class="q">(a) Telephone Number (Office)</span><span class="ln">{{ v().telOffice }}</span><span class="q">(b) Residence</span><span class="ln">{{ v().telRes }}</span></div>
    <div class="f"><span class="n"></span><span class="q">(c) Cell:</span><span class="ln" style="max-width:80mm">{{ v().cell }}</span></div>
    <div class="f"><span class="n">12.</span><span class="q">Mother's Qualification &amp; occupation, if any</span><span class="ln">{{ v().mother }}</span></div>
    <div class="f"><span class="n">13.</span><span class="q">Father's monthly income:</span><span class="ln">{{ v().income }}</span></div>
    <div class="f"><span class="n">14.</span><span class="q">(a) School / College last attended:</span><span class="ln">{{ v().prevSchool }}</span></div>
    <div class="f"><span class="n"></span><span class="q">(b) Dues paid there upto the month of:</span><span class="ln">{{ v().duesUpto }}</span></div>
    <div class="f"><span class="n"></span><span class="q">(c) Class last attended:</span><span class="ln">{{ v().prevClass }}</span><span class="q">(d) Medium:</span><span class="ln" style="flex:.6">{{ v().medium }}</span></div>
    <div class="f"><span class="n">15.</span><span class="q">Distinction / Scholarship won in studies, if any:</span><span class="ln">{{ v().distinction }}</span></div>
    <div class="f"><span class="n">16.</span><span class="q">Interest in co-curricular activities, if any:</span><span class="ln">{{ v().cocurricular }}</span></div>
    <div class="f"><span class="n">17.</span><span class="q">Transport required:</span>
      <span><span class="tick">{{ v().transport.need ? '' : '✓' }}</span>No <span class="tick">{{ v().transport.need ? '✓' : '' }}</span>Yes</span>
      <span class="q">Route / stop:</span><span class="ln">{{ v().transport.need ? v().transport.route + (v().transport.stop ? ' / ' + v().transport.stop : '') : '' }}</span></div>
    <div class="f"><span class="n"></span>
      <span><span class="tick">{{ v().transport.need && v().transport.mode === 'both' ? '✓' : '' }}</span>Pick and drop <span class="tick">{{ v().transport.need && v().transport.mode === 'pickup' ? '✓' : '' }}</span>Pick up only <span class="tick">{{ v().transport.need && v().transport.mode === 'drop' ? '✓' : '' }}</span>Drop only</span>
      <span class="q">Transport fee Rs</span><span class="ln" style="max-width:34mm">{{ v().transport.need && v().filled ? v().transport.fee : '' }}</span></div>
    @if (v().transport.need && v().transport.times) { <div class="small" style="margin-left:8mm">{{ v().transport.times }}</div> }

    <p class="bold" style="margin:3mm 0 0">I hereby certify that the above information is correct to the best of my belief and knowledge. I undertake that I shall conform to the rules / regulations of the college.</p>
    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:7mm"><div class="f" style="width:60mm"><span class="q bold">Dated:</span><span class="ln"></span></div><div class="bold" style="border-top:.3mm solid #000;padding-top:1mm;min-width:60mm;text-align:right">Signature of Father / Guardian</div></div>

    <div class="bar">(FOR OFFICE USE ONLY)</div>
    <div class="f"><span class="q">Reference:</span><span class="q">Admission Test held on</span><span class="ln">{{ v().testDate }}</span><span class="q">Admission of</span></div>
    <div class="g2"><div class="f"><span class="q">Master / Miss</span><span class="ln">{{ v().filled ? v().name : '' }}</span></div><div class="f"><span class="q">in approved for class</span><span class="ln">{{ v().filled ? v().className : '' }}</span></div></div>
    <div class="g2"><div class="f"><span class="q">Section</span><span class="ln">{{ v().section }}</span></div><div class="f"><span class="q">House</span><span class="ln">{{ v().house }}</span></div></div>
    <div class="g2"><div class="f"><span class="q">Admission No</span><span class="ln">{{ v().admissionNo }}</span></div><div class="f"><span class="q">Date of Admission</span><span class="ln">{{ v().admissionDate }}</span></div></div>
    <div class="g2"><div class="f"><span class="q">Total Fee received</span><span class="ln">{{ v().feeReceived }}</span></div><div class="f"><span class="q">Receipt No. / Date</span><span class="ln">{{ join([v().receiptNo, v().receiptDate], ' / ') }}</span></div></div>
    @if (v().missing.length) { <p class="small"><b>Documents still missing:</b> {{ v().missing.join(', ') }}</p> }
    <div class="sigrow" style="margin-top:5mm">
      <div><div class="f" style="width:60mm"><span class="ln" style="border-bottom-style:solid"></span></div><b>Sign of Accountant</b><div class="f" style="width:60mm"><span class="q">Date</span><span class="ln"></span></div></div>
      @if (v().qr; as q) { <div class="qr" [innerHTML]="q" title="Scan to open the student profile"></div> } @else { <span></span> }
      <div style="text-align:right"><div class="f" style="width:60mm;margin-left:auto"><span class="ln" style="border-bottom-style:solid"></span></div><b>HM</b><div class="f" style="width:60mm;margin-left:auto"><span class="q">Date</span><span class="ln"></span></div></div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:5mm">
      <div><div class="f" style="width:60mm"><span class="ln" style="border-bottom-style:solid"></span></div><b>Sign of Class Teacher</b><div class="f" style="width:60mm"><span class="q">Date</span><span class="ln"></span></div></div>
      <div style="text-align:right"><div class="f" style="width:60mm;margin-left:auto"><span class="ln" style="border-bottom-style:solid"></span></div><b>Principal</b><div class="f" style="width:60mm;margin-left:auto"><span class="q">Date</span><span class="ln"></span></div></div>
    </div>
  </section>

  <section class="pg" aria-label="School admission form, back">
    <h3 class="cen t2" style="margin-top:6mm">DECLARATION OF STUDENT</h3>
    <ol class="dec">
      <li>I understand that admission to KRL Model College for Boys is a privilege and in the event of my selection as a student, I accept to abide by the rules and regulations of this College.</li>
      <li>I shall be punctual and regular in attendance and serious in studies, and take all tests / examination given to me from time to time during my stay in the College.</li>
      <li>I clearly understand that if in the opinion of the Principal, results of tests / examinations are not satisfactory or if fall short of the required percentage, the Principal has the power to remove my name from the rolls of the College and he may not readmit me.</li>
      <li>I accept the discretion of the Principal to detain a student before or at the time of the Board Examination, if I do not ful-fil the requirements of the Board and of the College.</li>
      <li>I shall faithfully abide by the rules / regulations of College Discipline and shall, under all circumstances act in a manner which upholds the dignity and traditions of KRL Model College for Boys. I further declare that I shall never indulge in unpleasant / unhealthy activities during my stay in the College.</li>
      <li>I agree to accept as binding the decision of the Principal in all matters of the College.</li>
    </ol>
    <div class="sig" style="margin-top:8mm"><span class="bold">Dated: ______________</span><div>Signature of Student</div></div>
    <h3 class="cen t2" style="margin-top:12mm">DECLARATION OF PARENT</h3>
    <p style="text-align:justify;margin:4mm 0">I hereby affirm that my son is our mutual responsibility and I solemnly assure the Principal that I shall remain in constant contact in connection with the academic progress and conduct &amp; behavior of my son.</p>
    <p style="text-align:justify;margin:4mm 0">I understand that my inability to attend the College, as and when required, will authorize the Principal to take any ex parte decision in respect of my son and that it shall be binding on me under all circumstances.</p>
    <div class="sig" style="margin-top:12mm"><span class="bold">Dated: ______________</span><div>Signature of Father/Guardian</div></div>
    <app-form-fee-box [fee]="v().fee" [chart]="v().chart" [tr]="v().transport" />
    <hr style="margin:6mm 0 4mm;border:0;border-top:.4mm solid #000">
    <div style="display:flex;gap:10mm"><b style="width:18mm">NOTE:</b><div>Please attach the following with this Application Form:-
      <ol type="i" style="margin:2mm 0;padding-left:8mm"><li>03 photographs of the Student + 1" x 1" (02).</li><li>Original School / College Leaving Certificate, duly countersigned by DEO / GSO-I of the concerned District / Region.</li><li>Original Migration Certificate in case of admission to class IX.</li></ol></div></div>
  </section>
  `
})
export class SchoolForm {
  v = input.required<FormView>(); cfg = inject(SettingsService); mode = MODE_LABEL;
  join = (a: string[], sep = ', ') => a.filter(Boolean).join(sep);
}
