/* The report format (report.js). A review used to export as a table — one row
 * per finding, columns Object / Attributes / Problem / What should change /
 * Status. It now exports as a block per finding, the shape the reviewer asked
 * for: a heading naming the object ("Microflow: Sales.CancelOrder"), the
 * attribute(s) it is about, what is wrong, then "Recommendation: …". This
 * checks the Word clipboard HTML, the plain-text flavour, and the standalone
 * encrypted-report renderer all produce that shape. */
'use strict';

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxReport', 15000, 'MxScout loaded');

  const out = JSON.parse(await mx.evaluate(`(function(){
    var findings = [
      { target: { kind: 'microflow', qualifiedName: 'Sales.CancelOrder', attributes: [] }, severity: 'high', problem: 'No access check before it runs', change: 'Add a role check at the top', status: 'open' },
      { target: { kind: 'entity', qualifiedName: 'Sales.Order', attributes: ['Total', 'Customer'] }, severity: 'medium', problem: 'Total is world-readable', change: 'Restrict Total to Agent', status: 'fixed' },
      // A comment written the way people actually write one: a line, a blank
      // line, then steps. Those breaks are part of what it says and have to
      // survive into every output. The angle brackets are here because the
      // line-break handling must not become a way to smuggle markup out of a
      // comment and into somebody else's document.
      { target: { kind: 'entity', qualifiedName: 'Sales.Note', attributes: [] }, severity: 'low',
        problem: 'First line\\n\\nSecond paragraph\\nthird line <b>not bold</b>',
        change: 'Step one\\nStep two', status: 'open' }
    ];
    var data = MxReport.buildReportData({ name: 'Demo' }, findings, 'all comments');
    return JSON.stringify({
      word: MxReport.toWordHtml(data),
      text: MxReport.toPlainText(data),
      html: MxReport.buildStandaloneReport({ kdf: { salt: '', iterations: 1 }, cipher: { iv: '' }, payload: '', compression: 'none' }, 'Demo')
    });
  })()`));

  // ---- Word clipboard HTML ----
  t.ok(/<h3>Microflow: Sales\.CancelOrder<\/h3>/.test(out.word),
    'each finding leads with a heading naming its kind and object');
  t.ok(/<b>Recommendation:<\/b> Add a role check at the top/.test(out.word),
    'and ends with a labelled Recommendation, not a "What should change" column');
  t.ok(/Attributes: Total, Customer/.test(out.word),
    'a finding about specific attributes names them as additional info');
  t.ok(!/What should change/.test(out.word) && !/<th/.test(out.word) && !/<td/.test(out.word),
    'the old table (columns and cells) is gone');

  // ---- plain-text flavour ----
  t.ok(/Microflow: Sales\.CancelOrder/.test(out.text) && /Recommendation: Add a role check at the top/.test(out.text),
    'the plain-text flavour is blocks too, with the same heading and Recommendation');

  // ---- the line breaks somebody typed survive the trip ----
  // A comment is written in a textarea and its paragraph breaks are part of
  // what it says. HTML collapses them, so the Word flavour turns them into
  // the one tag that means "line break" — after escaping, never before.
  t.ok(/First line<br><br>Second paragraph<br>third line/.test(out.word),
    'Word gets the breaks as <br>, blank line included: ' + (/First line[^<]*(<br>)*[^<]*/.exec(out.word) || [''])[0]);
  t.ok(/<b>Recommendation:<\/b> Step one<br>Step two/.test(out.word),
    'and so does the recommendation');
  t.ok(/&lt;b&gt;not bold&lt;\/b&gt;/.test(out.word),
    'markup typed INTO a comment is still escaped — the break handling runs after escaping, not before');
  t.ok(!/<b>not bold<\/b>/.test(out.word),
    'so nothing a comment contains can become real markup in somebody else’s document');

  t.ok(/First line\n\nSecond paragraph\nthird line/.test(out.text),
    'the plain-text flavour carries them as real newlines');

  // ---- standalone encrypted report renderer ----
  t.ok(/Recommendation: /.test(out.html) && /'finding'/.test(out.html),
    'the standalone report draws findings as blocks with a Recommendation line');
  t.ok(!/What should change/.test(out.html) && !/'Object','Attributes'/.test(out.html),
    'and no longer builds the old five-column table');
  // The viewer sets that text with textContent, so CSS is what renders the
  // breaks — no markup is built from a comment on this path at all.
  t.ok(/\.finding p\{[^}]*white-space:pre-wrap/.test(out.html),
    'and keeps a comment’s line breaks with CSS rather than by building markup from it');

  await mx.close();
};
