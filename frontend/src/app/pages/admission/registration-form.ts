import { Component, inject, input } from '@angular/core';
import { SettingsService } from '../../core/settings';
import { FORM_CSS, FormView } from './form-data';

/** KRL Model College for Boys, Kahuta - registration form for every student, school or college (one sheet, with the test result table). */
@Component({
  selector: 'app-registration-form',
  styles: [FORM_CSS],
  template: `
  <section class="pg" aria-label="Registration form">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div style="width:62mm"><div class="f"><span class="q">Registration No</span><span class="ln">{{ v().regNo }}</span></div><div class="f"><span class="q">Date of Issue</span><span class="ln">{{ v().issueDate }}</span></div></div>
      <div class="logo">@if (cfg.logoUrl()) { <img [src]="cfg.logoUrl()" alt=""> } @else { <span>{{ cfg.initial() }}</span> }</div>
      <div style="width:62mm"><div class="f"><span class="q">Category</span><span class="ln">{{ v().category }}</span></div></div>
    </div>
    <div class="cen" style="margin-top:2mm"><p class="t1">{{ cfg.instituteName() }}</p><p class="t2">REGISTRATION FORM</p></div>
    <p style="margin:4mm 0 2mm;text-align:justify"><b class="u">Note:-</b> Completion of this form in itself does not, in any way, entitles the applicant for admission. The details required are for information only. Please attach photocopy of School Leaving Certificate.</p>

    <p class="bold" style="margin:3mm 0 0"><span style="display:inline-block;width:9mm">1.</span><span class="u">PARTICULARS OF STUDENT</span></p>
    <div class="f"><span class="n">i)</span><span class="q">Student's Name (Block Letters):</span><span class="ln">{{ v().name }}</span></div>
    <div class="f"><span class="n">ii)</span><span class="q">Date of Birth:</span><span class="ln" style="flex:.7">{{ v().dob }}</span><span class="q">(in words)</span><span class="ln">{{ v().dobWords }}</span></div>
    <div class="f"><span class="n">iii)</span><span class="q">Name of School last attended:</span><span class="ln">{{ v().prevSchool }}</span></div><div class="f"><span class="n"></span><span class="ln"></span></div>
    <div class="f"><span class="n">iv)</span><span class="q">Class in which studying / promoted:</span><span class="ln">{{ v().prevClass }}</span><span class="q">Medium:</span><span class="ln">{{ v().medium }}</span></div>
    <div class="f"><span class="n">v)</span><span class="q">Class in which to be admitted:</span><span class="ln">{{ v().admitClass }}</span><span class="q">vi.&nbsp;&nbsp; Blood Group</span><span class="ln" style="flex:.7">{{ v().bloodGroup }}</span></div>

    <p class="bold" style="margin:4mm 0 0"><span style="display:inline-block;width:9mm">2.</span><span class="u">PARTICULARS OF PARENTS / GUARDIAN</span></p>
    <div class="f"><span class="n">i)</span><span class="q">Father's Name:</span><span class="ln">{{ v().father }}</span></div>
    <div class="f"><span class="n">ii)</span><span class="q">Qualifications:</span><span class="ln">{{ v().fatherQual }}</span></div>
    <div class="f"><span class="n">iii)</span><span class="q">Designation/P. No.:</span><span class="ln">{{ join([v().fatherDesig, v().pno], ' / ') }}</span><span class="q">Division:</span><span class="ln" style="flex:.7">{{ v().fatherDiv }}</span><span class="q">SPS/BPS</span><span class="ln" style="flex:.5">{{ v().spsBps }}</span></div>
    <div class="f"><span class="n">iv)</span><span class="q">Official Address:</span><span class="ln">{{ v().officialAddress }}</span></div>
    <div class="f"><span class="n">v)</span><span class="q">Residential Address:</span><span class="ln">{{ v().address }}</span></div>
    <div class="f"><span class="n">vi)</span><span class="q">Telephone No. Office:</span><span class="ln">{{ v().telOffice }}</span><span class="q">Residence:</span><span class="ln">{{ v().telRes }}</span><span class="q">Mobile No.</span><span class="ln">{{ v().cell }}</span></div>
    <div class="f"><span class="n">vii)</span><span class="q">Permanent Home Address:</span><span class="ln">{{ v().permanent }}</span></div><div class="f"><span class="n"></span><span class="ln"></span></div>

    <p class="bold" style="margin:4mm 0 1mm"><span style="display:inline-block;width:9mm">3.</span><span class="u">PARTICULARS OF BROTHERS / SISTERS</span> <span style="font-size:8.5pt">(If studying in this college)</span></p>
    <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:0 10mm;margin-left:9mm"><b>Name</b><b>Class and Session</b>
      @for (s of sibs(); track $index) { <div class="f"><span class="q">{{ roman[$index] }}</span><span class="ln">{{ s.name }}</span></div><div class="f"><span class="ln">{{ s.class_session }}</span></div> }</div>

    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:8mm"><div class="f" style="width:60mm"><span class="q">Dated:</span><span class="ln"></span></div><div class="bold" style="border-top:.3mm solid #000;padding-top:1mm;min-width:62mm;text-align:right">Signature of Father / Guardian</div></div>
    <div class="bar">FOR OFFICE USE ONLY</div>
    <div class="f"><span class="q">Called for Test on:</span><span class="ln">{{ v().testDate }}</span><span class="q">for Admission to Class</span><span class="ln">{{ v().admitClass }}</span></div>
    <div class="f"><span class="q">Reported for Test Yes / No</span><span class="ln" style="max-width:30mm">{{ v().reported }}</span></div>
    <div style="display:grid;grid-template-columns:38mm 1fr;align-items:center;margin:1mm 0">
      <div><div style="height:9mm;display:flex;align-items:center">&nbsp;</div><div style="height:8mm;display:flex;align-items:center">Result: &nbsp;&nbsp;&nbsp;&nbsp;(I)</div><div style="height:8mm;display:flex;align-items:center">Retest, if any: (ii)</div></div>
      <table class="tb" style="text-align:center"><thead><tr><th class="cen">Urdu</th><th class="cen">English</th><th class="cen">Maths</th><th class="cen">Science</th><th class="cen">Total</th></tr></thead><tbody>
        <tr style="height:8mm"><td>{{ v().result.urdu }}</td><td>{{ v().result.english }}</td><td>{{ v().result.maths }}</td><td>{{ v().result.science }}</td><td>{{ v().result.total }}</td></tr>
        <tr style="height:8mm"><td>{{ v().retest.urdu }}</td><td>{{ v().retest.english }}</td><td>{{ v().retest.maths }}</td><td>{{ v().retest.science }}</td><td>{{ v().retest.total }}</td></tr></tbody></table></div>
    <div class="f"><span class="q">Remarks:</span><span class="ln">{{ v().remarks }}</span></div>
    <p style="margin:2mm 0"><span [class.sel]="v().decision === 'granted'">Admission granted</span> / <span [class.sel]="v().decision === 'not_granted'">not granted</span> / <span [class.sel]="v().decision === 'recommended'">recommended</span>.</p>
    <div class="sigrow" style="margin-top:6mm"><div class="f" style="width:60mm"><span class="q">Dated:</span><span class="ln">{{ v().decisionDate }}</span></div>
      @if (v().qr; as q) { <div class="qr" [innerHTML]="q" title="Scan to open the student profile"></div> } @else { <span></span> }
      <div class="bold" style="border-top:.3mm solid #000;padding-top:1mm;min-width:50mm;text-align:center">PRINCIPAL</div></div>
  </section>
  `
})
export class RegistrationForm {
  v = input.required<FormView>(); cfg = inject(SettingsService);
  roman = ['i)', 'ii)', 'iii)', 'iv)', 'v)'];
  join = (a: string[], sep = ', ') => a.filter(Boolean).join(sep);
  sibs = () => { const l = [...this.v().siblings]; while (l.length < 5) l.push({ name: '', class_session: '' }); return l.slice(0, 5); };
}
