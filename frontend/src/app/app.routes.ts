import { Routes } from '@angular/router';
import { attGuard, authGuard, homeGuard, testDeptGuard, examGuard, examOfficeGuard, feeGuard, guestGuard, hrOfficeGuard, hrPayGuard, managerGuard, sylOfficeGuard, systemGuard } from './core/auth';

export const routes: Routes = [
  { path: 'login', canActivate: [guestGuard], loadComponent: () => import('./pages/login').then(m => m.Login) },
  { path: 'verify/:code', title: 'Verify receipt', loadComponent: () => import('./pages/verify-receipt').then(m => m.VerifyReceipt) },
  { path: 'result', title: 'Check result', loadComponent: () => import('./pages/public-result').then(m => m.PublicResult) },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell').then(m => m.Shell),
    children: [
      { path: '', pathMatch: 'full', title: 'Dashboard', canActivate: [homeGuard], loadComponent: () => import('./pages/dashboard').then(m => m.Dashboard) },
      { path: 'classes', title: 'Classes & Sections', loadComponent: () => import('./pages/classes').then(m => m.Classes) },
      { path: 'scan/:reg', title: 'Student', loadComponent: () => import('./pages/scan').then(m => m.Scan) },
      { path: 'students', title: 'Students', loadComponent: () => import('./pages/students').then(m => m.Students) },
      { path: 'me', title: 'My Home', loadComponent: () => import('./teacher/teacher-home').then(m => m.TeacherHome) },
      { path: 'files', title: 'My Files', loadComponent: () => import('./teacher/my-files').then(m => m.MyFiles) },
      { path: 'cards', title: 'ID & Transport Cards', canActivate: [managerGuard], loadComponent: () => import('./cards/cards').then(m => m.Cards) },
      { path: 'sheets', title: 'Sheets & Lists', loadComponent: () => import('./sheets/sheets').then(m => m.Sheets) },
      { path: 'system', title: 'System & Safety', canActivate: [systemGuard], loadComponent: () => import('./system/system').then(m => m.System) },
      { path: 'college', title: 'College Profile', canActivate: [systemGuard], loadComponent: () => import('./college/college-profile').then(m => m.CollegeProfile) },
      { path: 'teachers', title: 'Teachers', canActivate: [systemGuard], loadComponent: () => import('./faculty/teachers').then(m => m.Teachers) },
      { path: 'security', title: 'My security', loadComponent: () => import('./security/security').then(m => m.Security) },
      { path: 'parent-messages', title: 'Parent Messages', canActivate: [managerGuard], loadComponent: () => import('./parentmsg/parent-msg').then(m => m.ParentMsg) },
      { path: 'discipline', title: 'Discipline & Behaviour', canActivate: [managerGuard], loadComponent: () => import('./discipline/discipline').then(m => m.Discipline) },
      { path: 'notices', title: 'Notice Board', canActivate: [managerGuard], loadComponent: () => import('./notice/notice-board').then(m => m.NoticeBoard) },
      { path: 'inventory', title: 'Inventory', loadComponent: () => import('./inventory/inventory').then(m => m.Inventory) },
      { path: 'duties', title: 'Additional Charges', canActivate: [managerGuard], loadComponent: () => import('./duties/duties').then(m => m.Duties) },
      { path: 'paper-setting', title: 'Paper Setting', canActivate: [examGuard], loadComponent: () => import('./papers/paper-setting').then(m => m.PaperSetting) },
      { path: 'test-dept', title: 'Test Department', canActivate: [testDeptGuard], loadComponent: () => import('./testdept/test-dept').then(m => m.TestDept) },
      { path: 'downloads', title: 'Download Center', loadComponent: () => import('./downloads/downloads').then(m => m.Downloads) },
      { path: 'tasks', title: 'Tasks', loadComponent: () => import('./tasks/tasks').then(m => m.Tasks) },
      { path: 'communication', title: 'Communication', loadComponent: () => import('./communication/communication').then(m => m.Communication) },
      { path: 'communication/new', title: 'New notice', canActivate: [managerGuard], loadComponent: () => import('./communication/comm-form').then(m => m.CommForm) },
      { path: 'communication/:id/edit', title: 'Change draft', canActivate: [managerGuard], loadComponent: () => import('./communication/comm-form').then(m => m.CommForm) },
      { path: 'communication/:id/print', title: 'Print notice', loadComponent: () => import('./communication/comm-print').then(m => m.CommPrint) },
      { path: 'ptm', title: 'Parent Teacher Meeting', canActivate: [examGuard], loadComponent: () => import('./ptm/ptm').then(m => m.Ptm) },
      { path: 'ptm/:id', title: 'Meeting', canActivate: [examGuard], loadComponent: () => import('./ptm/ptm-meeting').then(m => m.PtmMeeting) },
      { path: 'ptm/:id/print', title: 'Print meeting sheets', canActivate: [examGuard], loadComponent: () => import('./ptm/ptm-print').then(m => m.PtmPrint) },
      { path: 'frontdesk', title: 'Front Desk', canActivate: [managerGuard], loadComponent: () => import('./frontdesk/frontdesk').then(m => m.Frontdesk) },
      { path: 'diary', title: 'Daily Diary', canActivate: [examGuard], loadComponent: () => import('./diary/diary').then(m => m.Diary) },
      { path: 'diary/print', title: 'Print diary', canActivate: [examGuard], loadComponent: () => import('./diary/diary-print').then(m => m.DiaryPrint) },
      { path: 'students/categories', title: 'Categories and reports', loadComponent: () => import('./pages/category-report').then(m => m.CategoryReport) },
      { path: 'import', title: 'Import data', loadComponent: () => import('./pages/data-import').then(m => m.DataImport) },
      { path: 'students/form/:id', title: 'Admission form', loadComponent: () => import('./pages/admission-form').then(m => m.AdmissionForm) },
      { path: 'students/:id', title: 'Student profile', loadComponent: () => import('./pages/student-profile').then(m => m.StudentProfile) },
      {
        path: 'timetable', title: 'Timetable', loadComponent: () => import('./timetable/tt-shell').then(m => m.TtShell),
        children: [
          { path: '', loadComponent: () => import('./timetable/tt-generate').then(m => m.TtGenerate) },
          { path: 'view', loadComponent: () => import('./timetable/tt-view').then(m => m.TtView) },
          { path: 'config', loadComponent: () => import('./timetable/tt-config').then(m => m.TtConfig) },
          { path: 'subjects', loadComponent: () => import('./timetable/tt-subjects').then(m => m.TtSubjects) },
          { path: 'teachers', loadComponent: () => import('./timetable/tt-teachers').then(m => m.TtTeachers) },
          { path: 'curriculum', loadComponent: () => import('./timetable/tt-curriculum').then(m => m.TtCurriculum) },
          { path: 'quality', loadComponent: () => import('./timetable/tt-quality').then(m => m.TtQuality) },
          { path: 'free', loadComponent: () => import('./timetable/tt-free').then(m => m.TtFree) },
          { path: 'master', loadComponent: () => import('./timetable/tt-master').then(m => m.TtMaster) },
          { path: 'versions', loadComponent: () => import('./timetable/tt-versions').then(m => m.TtVersions) },
          { path: 'subs', loadComponent: () => import('./timetable/tt-subs').then(m => m.TtSubs) }
        ]
      },
      {
        path: 'fee', title: 'Fee Management', canActivate: [feeGuard], loadComponent: () => import('./fee/fee-shell').then(m => m.FeeShell),
        children: [
          { path: '', loadComponent: () => import('./fee/fee-home').then(m => m.FeeHome) },
          { path: 'generate', loadComponent: () => import('./fee/fee-generate').then(m => m.FeeGenerate) },
          { path: 'vouchers', loadComponent: () => import('./fee/fee-vouchers').then(m => m.FeeVouchers) },
          { path: 'collect', loadComponent: () => import('./fee/fee-collect').then(m => m.FeeCollect) },
          { path: 'defaulters', loadComponent: () => import('./fee/fee-defaulters').then(m => m.FeeDefaulters) },
          { path: 'forecast', loadComponent: () => import('./fee/fee-forecast').then(m => m.FeeForecast) },
          { path: 'structure', loadComponent: () => import('./fee/fee-structure').then(m => m.FeeStructure) },
          { path: 'categories', loadComponent: () => import('./fee/fee-categories').then(m => m.FeeCategories) },
          { path: 'settings', loadComponent: () => import('./fee/fee-settings').then(m => m.FeeSettingsPage) },
          { path: 'student/:id', loadComponent: () => import('./fee/fee-student').then(m => m.FeeStudent) },
          { path: 'print', loadComponent: () => import('./fee/fee-print').then(m => m.FeePrint) },
          { path: 'receipt/:id', loadComponent: () => import('./fee/fee-receipt').then(m => m.FeeReceipt) }
        ]
      },
      {
        path: 'attendance', title: 'Attendance', canActivate: [attGuard], loadComponent: () => import('./attendance/att-shell').then(m => m.AttShell),
        children: [
          { path: '', canActivate: [managerGuard], loadComponent: () => import('./attendance/att-dashboard').then(m => m.AttDashboard) },
          { path: 'daily', loadComponent: () => import('./attendance/att-daily').then(m => m.AttDaily) },
          { path: 'period', loadComponent: () => import('./attendance/att-period').then(m => m.AttPeriod) },
          { path: 'register', loadComponent: () => import('./attendance/att-register').then(m => m.AttRegister) },
          { path: 'register-print', loadComponent: () => import('./attendance/att-register-print').then(m => m.AttRegisterPrint) },
          { path: 'leaves', canActivate: [managerGuard], loadComponent: () => import('./attendance/att-leaves').then(m => m.AttLeaves) },
          { path: 'reports', canActivate: [managerGuard], loadComponent: () => import('./attendance/att-reports').then(m => m.AttReports) },
          { path: 'settings', canActivate: [managerGuard], loadComponent: () => import('./attendance/att-settings').then(m => m.AttSettings) },
          { path: 'student/:id', loadComponent: () => import('./attendance/att-student').then(m => m.AttStudent) }
        ]
      },
      {
        path: 'exams', title: 'Examination', canActivate: [examGuard], loadComponent: () => import('./exam/exam-shell').then(m => m.ExamShell),
        children: [
          { path: '', canActivate: [examOfficeGuard], loadComponent: () => import('./exam/exam-list').then(m => m.ExamList) },
          { path: 'detail/:id', canActivate: [examOfficeGuard], loadComponent: () => import('./exam/exam-detail').then(m => m.ExamDetail) },
          { path: 'papers', loadComponent: () => import('./exam/exam-papers').then(m => m.ExamPapers) },
          { path: 'marks/:id', loadComponent: () => import('./exam/exam-marks').then(m => m.ExamMarks) },
          { path: 'sheet', loadComponent: () => import('./exam/exam-sheet').then(m => m.ExamSheet) },
          { path: 'followups', loadComponent: () => import('./exam/exam-followups').then(m => m.ExamFollowups) },
          { path: 'duty', canActivate: [examOfficeGuard], loadComponent: () => import('./exam/exam-duty').then(m => m.ExamDuty) },
          { path: 'analysis', canActivate: [examOfficeGuard], loadComponent: () => import('./exam/exam-analysis').then(m => m.ExamAnalysis) },
          { path: 'awards', canActivate: [examOfficeGuard], loadComponent: () => import('./exam/exam-awards').then(m => m.ExamAwards) },
          { path: 'board', canActivate: [examOfficeGuard], loadComponent: () => import('./exam/exam-board').then(m => m.ExamBoard) },
          { path: 'settings', canActivate: [examOfficeGuard], loadComponent: () => import('./exam/exam-settings').then(m => m.ExamSettings) },
          { path: 'print/:kind', loadComponent: () => import('./exam/exam-print').then(m => m.ExamPrint) }
        ]
      },
      {
        path: 'syllabus', title: 'Syllabus', canActivate: [examGuard], loadComponent: () => import('./syllabus/syl-shell').then(m => m.SylShell),
        children: [
          { path: '', canActivate: [sylOfficeGuard], loadComponent: () => import('./syllabus/syl-dashboard').then(m => m.SylDashboard) },
          { path: 'mine', loadComponent: () => import('./syllabus/syl-mine').then(m => m.SylMine) },
          { path: 'plans', loadComponent: () => import('./syllabus/syl-plans').then(m => m.SylPlans) },
          { path: 'plan/:id', loadComponent: () => import('./syllabus/syl-editor').then(m => m.SylEditor) },
          { path: 'track/:id', loadComponent: () => import('./syllabus/syl-track').then(m => m.SylTrack) },
          { path: 'calendar', loadComponent: () => import('./syllabus/syl-calendar').then(m => m.SylCalendar) },
          { path: 'portion', loadComponent: () => import('./syllabus/syl-portion').then(m => m.SylPortion) },
          { path: 'settings', canActivate: [sylOfficeGuard], loadComponent: () => import('./syllabus/syl-settings').then(m => m.SylSettings) },
          { path: 'print/:kind', loadComponent: () => import('./syllabus/syl-print').then(m => m.SylPrint) }
        ]
      },
      {
        path: 'transport', title: 'Transport', canActivate: [feeGuard], loadComponent: () => import('./transport/tr-shell').then(m => m.TrShell),
        children: [
          { path: '', loadComponent: () => import('./transport/tr-overview').then(m => m.TrOverview) },
          { path: 'routes', loadComponent: () => import('./transport/tr-routes').then(m => m.TrRoutes) },
          { path: 'route/:id', loadComponent: () => import('./transport/tr-route').then(m => m.TrRoute) },
          { path: 'students', loadComponent: () => import('./transport/tr-students').then(m => m.TrStudents) },
          { path: 'vehicles', loadComponent: () => import('./transport/tr-vehicles').then(m => m.TrVehicles) },
          { path: 'staff', loadComponent: () => import('./transport/tr-staff').then(m => m.TrStaff) },
          { path: 'boarding', loadComponent: () => import('./transport/tr-boarding').then(m => m.TrBoarding) },
          { path: 'reports', loadComponent: () => import('./transport/tr-reports').then(m => m.TrReports) },
          { path: 'print/:kind', loadComponent: () => import('./transport/tr-print').then(m => m.TrPrint) }
        ]
      },
      {
        path: 'hr', title: 'HR Management', loadComponent: () => import('./hr/hr-shell').then(m => m.HrShell),
        children: [
          { path: '', canActivate: [hrOfficeGuard], loadComponent: () => import('./hr/hr-overview').then(m => m.HrOverview) },
          { path: 'staff', canActivate: [hrOfficeGuard], loadComponent: () => import('./hr/hr-staff').then(m => m.HrStaffList) },
          { path: 'staff/:id', canActivate: [hrOfficeGuard], loadComponent: () => import('./hr/hr-profile').then(m => m.HrProfile) },
          { path: 'attendance', canActivate: [hrOfficeGuard], loadComponent: () => import('./hr/hr-attendance').then(m => m.HrAttendance) },
          { path: 'leaves', canActivate: [hrOfficeGuard], loadComponent: () => import('./hr/hr-leaves').then(m => m.HrLeaves) },
          { path: 'payroll', canActivate: [hrPayGuard], loadComponent: () => import('./hr/hr-payroll').then(m => m.HrPayroll) },
          { path: 'salary', canActivate: [hrPayGuard], loadComponent: () => import('./hr/hr-salary').then(m => m.HrSalary) },
          {
            path: 'recruit', canActivate: [hrOfficeGuard], loadComponent: () => import('./hr/rec-shell').then(m => m.RecShell),
            children: [
          { path: 'settings', loadComponent: () => import('./hr/rec-settings').then(m => m.RecSettings) },
              { path: '', loadComponent: () => import('./hr/rec-jobs').then(m => m.RecJobs) },
              { path: 'candidates', loadComponent: () => import('./hr/rec-candidates').then(m => m.RecCandidates) },
              { path: 'candidate/:id', loadComponent: () => import('./hr/rec-candidate').then(m => m.RecCandidate) },
              { path: 'interviews', loadComponent: () => import('./hr/rec-interviews').then(m => m.RecInterviews) }
            ]
          },
          { path: 'reports', loadComponent: () => import('./hr/hr-reports').then(m => m.HrReports) },
          { path: 'settings', canActivate: [hrOfficeGuard], loadComponent: () => import('./hr/hr-settings').then(m => m.HrSettings) },
          { path: 'mine', loadComponent: () => import('./hr/hr-mine').then(m => m.HrMine) },
          { path: 'print/:kind', loadComponent: () => import('./hr/hr-print').then(m => m.HrPrint) }
        ]
      },
      { path: 'profile', title: 'My Profile', loadComponent: () => import('./pages/profile').then(m => m.Profile) },
    ]
  },
  { path: '**', redirectTo: '' }
];
