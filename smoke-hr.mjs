import { installDom, withId } from './tests/dom-shim.mjs';
import { Grid } from './src/main.js';
import { openHealthReport } from './src/ui/health-report.js';

const doc = installDom();
withId(doc, 'app');
withId(doc, 'grid');
const columns = [
  { field: 'email', header: 'Email', type: 'text' },
  { field: 'ssn', header: 'SSN', type: 'text' },
  { field: 'service', header: 'Subscription', type: 'text' },
  { field: 'price', header: 'Price', type: 'currency' },
  { field: 'billing', header: 'Billing', type: 'text' },
  { field: 'penalty', header: 'Penalty', type: 'currency' },
];
const grid = new Grid(doc.getElementById('grid'), { columns, adapter: null, useWorker: false, stats: false });
grid.state.set('rows', [
  { id: 1, email: 'wei@corp.com', ssn: '123-45-6789', service: 'Netflix', price: '$15.99', billing: 'monthly', penalty: '' },
  { id: 2, email: 'we@@corp.com', ssn: '666-12-3456', service: 'Netflix', price: '$15.99', billing: 'monthly', penalty: '$25.00' },
  { id: 3, email: 'Wei@Corp.COM', ssn: '987-65-4321', service: 'Spotify', price: '$9.99', billing: 'monthly', penalty: '$5.00' },
]);
grid._typeMap = { email:'text', ssn:'text', service:'text', price:'currency', billing:'text', penalty:'currency' };

let closed = false;
const close = openHealthReport({ grid, toast: () => {}, onClose: () => { closed = true; } });
const panel = doc.querySelector('.af-health');
console.log('panel present:', !!panel);
console.log('pack select present:', !!panel.querySelector('select.af-select'));
console.log('pack hint text:', panel.querySelector('.af-hr-packhint')?.textContent);
console.log('insights title present:', !!panel.querySelector('.af-hr-insights-title'));
console.log('insight cards:', panel.querySelectorAll('.af-hr-insight').length);
console.log('finding rows:', panel.querySelectorAll('.af-hr-row').length);
console.log('pack tags:', [...panel.querySelectorAll('.af-hr-packtag')].map(t=>t.textContent));
// exercise dropdown change -> finance
const sel = panel.querySelector('select.af-select');
sel.value = 'industry.finance';
sel.dispatch('change', { target: { value: 'industry.finance' } });
console.log('after switch, pack hint:', panel.querySelector('.af-hr-packhint')?.textContent);

// click "Locate" on first insight
const locateBtn = panel.querySelector('.af-hr-insight-actions .af-btn');
locateBtn.dispatch('click');
console.log('closed after locate:', closed, 'flagged:', grid.state.get('flagged').size);
