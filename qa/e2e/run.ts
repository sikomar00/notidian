// npm run qa:e2e — dist를 헤드리스 Chrome에 올려 화면 동작을 자동으로 점검한다(P1-9). 스크린샷은 qa/e2e/out/에 남는다(git 제외).
// 실제 Notion·실제 토큰은 쓰지 않는다. 옆 패널 자체는 헤드리스에서 열 수 없어 같은 화면(graph.html?mode=side)을 탭으로 연다.
import { RESET } from './fixtures.ts';
import { autoRefreshSetting, currentPage, exportFiles, filtersAndGroups, graphBasics, optionsAndSeed, tokenSecurity } from './graphScenarios.ts';
import { createReport, launch } from './harness.ts';
import { localGraph, narrowLayout, sidePanelFollow } from './panelScenarios.ts';

const report = createReport();
const browser = await launch('dist', 'qa/e2e/out');
try {
  // 처음에 가짜 색인을 넣는다. 따라가기 점검은 페이지를 더 넣고 토큰 점검은 토큰을 지우므로 끝에 둔다
  for (const scenario of [optionsAndSeed, graphBasics, currentPage, filtersAndGroups, exportFiles, autoRefreshSetting, narrowLayout, localGraph, sidePanelFollow, tokenSecurity]) {
    await scenario(browser, report.check).catch((error: unknown) => {
      report.check(`${scenario.name} 실행`, false, error instanceof Error ? error.message : String(error));
    });
    await browser.closeTabs();
    const admin = await browser.open(browser.ext('options.html'));
    await admin.run(`new Promise((done) => (document.readyState === 'complete' ? done() : addEventListener('load', done)))`);
    await admin.run(RESET);
    await browser.closeTabs();
  }
} finally {
  browser.stop();
}
process.exitCode = report.finish() > 0 ? 1 : 0;
