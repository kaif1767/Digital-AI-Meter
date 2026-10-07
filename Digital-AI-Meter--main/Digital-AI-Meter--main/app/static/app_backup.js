let r = 'electricity';

const $ = (x) => document.getElementById(x);
const unit = () => (r === 'electricity' ? 'kWh' : 'L');

async function get(x) {
  return (await fetch(x)).json();
}

async function load() {
  let [s, d, an, i] = await Promise.all([
    get('/summary?resource=' + r),
    get('/meter-data?resource=' + r),
    get('/anomalies?resource=' + r),
    get('/ai-insight?resource=' + r),
  ]);

  $('cur').textContent = s.current.toFixed(2);
  $('avg').textContent = s.average.toFixed(2);
  $('peak').textContent = s.peak.toFixed(2);
  $('ac').textContent = an.length;
  $('u').textContent = unit() + ' / hour';
  $('insight').textContent = i.insight;

  chart(d);
  alerts(an);
  slots(d);
}

function chart(d) {
  let v = d.map((x) => +x.consumption);
  let W = 900;
  let H = 300;
  let p = 20;
  let M = Math.max(...v) * 1.08;
  let pts = v.map((x, i) => [
    p + i * (W - 2 * p) / (v.length - 1),
    H - p - x / M * (H - 2 * p),
  ]);
  let path = pts
    .map((q, i) => (i ? 'L' : 'M') + q[0] + ' ' + q[1])
    .join(' ');
  let svg = document.querySelector('#chart svg');

  svg.innerHTML =
    '<path d="M20 280 H880" stroke="#edf0f5"/>' +
    '<path d="' + path + '" fill="none" stroke="#3277df" stroke-width="3" stroke-linecap="round"/>' +
    pts
      .filter((_, i) => i % 12 === 0)
      .map((q) => `<circle cx="${q[0]}" cy="${q[1]}" r="3.5" fill="#3277df"/>`)
      .join('');
}

function alerts(a) {
  $('alerts').innerHTML =
    a.slice(-5).reverse().map((x) => `
      <div class="al">
        <b>⚠ Unusual ${r} usage</b><br>
        <small>${new Date(x.timestamp).toLocaleString()} • ${x.consumption} ${unit()} • ${x.severity} priority</small>
      </div>
    `).join('') || '<div class="answer">No unusual patterns detected.</div>';
}

function slots(d) {
  let b = [[], [], [], []];

  d.forEach((x) => {
    let h = new Date(x.timestamp).getHours();
    let index = h < 6 ? 0 : h < 12 ? 1 : h < 18 ? 2 : 3;
    b[index].push(Number(x.consumption));
  });

  ['n', 'm', 'a', 'ev'].forEach((id, i) => {
    let average = b[i].length
      ? b[i].reduce((sum, x) => sum + x, 0) / b[i].length
      : 0;
    $(id).textContent = average.toFixed(2) + ' ' + unit();
  });
}

$('e').onclick = () => {
  r = 'electricity';
  $('e').classList.add('active');
  $('w').classList.remove('active');
  load();
};

$('w').onclick = () => {
  r = 'water';
  $('w').classList.add('active');
  $('e').classList.remove('active');
  load();
};

$('ask').onclick = async () => {
  $('answer').textContent = 'Analyzing…';
  let q = $('q').value || 'Why did my usage spike?';
  let x = await get('/ask-ai?resource=' + r + '&question=' + encodeURIComponent(q));
  $('answer').textContent = x.answer;
};

load();

fetch('/recommendation?resource=' + r)
    .then(response => response.json())
    .then(data => {
        document.getElementById('recommendation').textContent =
            data.recommendation;
    });
