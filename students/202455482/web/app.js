// Cloud Map 웹 화면
// PostgREST(/api)에서 DB 데이터를 받아 통계·차트·AWS 구성도·보안 점검 표를 그립니다.

const app = document.getElementById('app');

const COLORS = {
  PASS: '#22c55e', FAIL: '#f43f5e',
  Critical: '#a855f7', High: '#f43f5e', Medium: '#f59e0b', Low: '#3b82f6',
  accent: '#6366f1', info: '#22d3ee',
};
const TYPE_COLORS = ['#6366f1', '#22d3ee', '#a855f7', '#f59e0b', '#22c55e', '#3b82f6', '#ec4899', '#14b8a6'];
const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'];
const TYPE_NAMES = {
  vpc: 'VPC', subnet: 'Subnet', alb: 'Application LB', 'ec2-instance': 'EC2',
  's3-bucket': 'S3 Bucket', 'cloudtrail-trail': 'CloudTrail', 'iam-role': 'IAM Role',
};
// 보안 점검 표의 리소스 종류 태그: 짧은 이름과 색(구성도 아이콘 색과 동일)
const RESOURCE_TAGS = {
  vpc: ['VPC', '#8C4FFF'], subnet: ['Subnet', '#00A4A6'], alb: ['ALB', '#8C4FFF'],
  'ec2-instance': ['EC2', '#ED7100'], 's3-bucket': ['S3', '#7AA116'], 'ebs-volume': ['EBS', '#7AA116'],
  'cloudtrail-trail': ['CloudTrail', '#E7157B'], 'iam-role': ['IAM', '#DD344C'], iam: ['IAM', '#DD344C'],
  account: ['계정', '#8b93a7'], region: ['리전', '#8b93a7'],
};
const tagLabel = type => (RESOURCE_TAGS[type] || [type])[0];
const ICON_PATHS = {
  cube: 'M12 3 4 7v10l8 4 8-4V7l-8-4Zm0 0v18M4 7l8 4 8-4',
  check: 'M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3Z',
  pass: 'M20 6 9 17l-5-5',
  fail: 'M18 6 6 18M6 6l12 12',
  alert: 'M12 9v4m0 4h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  info: 'M12 16v-4m0-4h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
};

// ---------------------------------------------------------------------------
// 공통
// ---------------------------------------------------------------------------

async function api(path) {
  const res = await fetch('api/' + path, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`API ${path} → HTTP ${res.status}`);
  return res.json();
}

function esc(value) {
  return String(value ?? '-').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function countBy(rows, key) {
  const counts = {};
  rows.forEach(r => { counts[r[key]] = (counts[r[key]] || 0) + 1; });
  return counts;
}

const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);

function icon(name, size = 18) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="${ICON_PATHS[name]}"/></svg>`;
}

function badge(text) {
  return `<span class="badge" style="--c:${COLORS[text] || '#8b93a7'}">${esc(text)}</span>`;
}

function codes(text) {
  if (!text || text === '-') return '<span style="color:var(--faint)">-</span>';
  return text.split(',').map(c => `<span class="code">${esc(c.trim())}</span>`).join('');
}

function resourceTag(type) {
  const [label, color] = RESOURCE_TAGS[type] || [type, '#8b93a7'];
  return `<span class="tag" style="--c:${color}">${esc(label)}</span>`;
}

// 리소스 이름. 구성도에 없는 리소스 단위 점검은 이름 아래에 '구성도 밖'을 표시합니다.
function resourceName(f) {
  const outside = !f.resource_id && !['account', 'region'].includes(f.resource_type);
  return `${esc(f.resource_name)}${outside ? '<small class="outside">구성도 밖</small>' : ''}`;
}

function kpi({ label, value, sub, color, iconName, ratio }) {
  const bar = ratio === undefined ? '' : `<div class="kpi-bar"><span style="width:${ratio}%"></span></div>`;
  return `<section class="card span-3 kpi" style="--c:${color}">
    <div class="kpi-top"><span class="kpi-icon">${icon(iconName)}</span>${esc(label)}</div>
    <div class="kpi-value">${value}</div>${bar}<div class="kpi-sub">${esc(sub)}</div></section>`;
}

function donutCard(title, caption, items, centerLabel) {
  const total = items.reduce((s, i) => s + i.value, 0);
  const r = 56, c = 2 * Math.PI * r, gap = items.filter(i => i.value).length > 1 ? 3 : 0;
  let offset = 0;
  const arcs = items.filter(i => i.value > 0).map(i => {
    const len = (i.value / (total || 1)) * c;
    const arc = `<circle r="${r}" cx="70" cy="70" fill="none" stroke="${i.color}" stroke-width="16"
      stroke-dasharray="${Math.max(len - gap, 0.1)} ${c}" stroke-dashoffset="${-offset}" transform="rotate(-90 70 70)">
      <title>${esc(i.label)}: ${i.value} (${pct(i.value, total)}%)</title></circle>`;
    offset += len;
    return arc;
  }).join('');
  const legend = items.map(i => `<li><span class="dot" style="background:${i.color}"></span>
    <span class="label">${esc(i.label)}</span><span class="n">${i.value}<small>${pct(i.value, total)}%</small></span></li>`).join('');
  return `<section class="card span-4"><div class="card-head"><div><h2>${esc(title)}</h2><p>${esc(caption)}</p></div></div>
    <div class="donut"><div class="donut-chart"><svg viewBox="0 0 140 140" width="140" height="140">
      <circle r="${r}" cx="70" cy="70" fill="none" stroke="#1b2029" stroke-width="16"/>${arcs}</svg>
      <div class="center"><b>${total}</b><small>${esc(centerLabel)}</small></div></div>
    <ul class="legend">${legend}</ul></div></section>`;
}

function setHeader(page, eyebrow, title) {
  document.querySelectorAll('.nav').forEach(t => t.classList.toggle('active', t.dataset.page === page));
  document.getElementById('eyebrow').textContent = eyebrow;
  document.getElementById('title').textContent = title;
  document.getElementById('updated').textContent =
    '마지막 조회 ' + new Date().toLocaleTimeString('ko-KR', { hour12: false });
}

// ---------------------------------------------------------------------------
// 1페이지: Cloud Architecture
// ---------------------------------------------------------------------------

async function renderArchitecture() {
  const [resources, relationships, findings] = await Promise.all([
    api('resources'), api('relationships'), api('findings?select=status,severity,resource_id'),
  ]);
  setHeader('architecture', 'Overview', 'Cloud Architecture');
  const status = countBy(findings, 'status');
  const severity = countBy(findings, 'severity');
  const types = countBy(resources, 'resource_type');
  const pass = status.PASS || 0, fail = status.FAIL || 0;

  app.innerHTML = [
    kpi({ label: '전체 AWS 리소스', value: resources.length, sub: `${Object.keys(types).length}개 유형 · 관계 ${relationships.length}개`, color: COLORS.accent, iconName: 'cube' }),
    kpi({ label: '전체 점검', value: findings.length, sub: 'Prowler 보안 설정 점검', color: COLORS.info, iconName: 'check' }),
    kpi({ label: 'PASS', value: pass, sub: `통과율 ${pct(pass, findings.length)}%`, color: COLORS.PASS, iconName: 'pass', ratio: pct(pass, findings.length) }),
    kpi({ label: 'FAIL', value: fail, sub: `실패율 ${pct(fail, findings.length)}%`, color: COLORS.FAIL, iconName: 'fail', ratio: pct(fail, findings.length) }),
    `<div class="notice">${icon('info', 16)}<span>점검 결과는 실제 AWS 계정의 Prowler 스캔에서 추린 데이터이며, 구성도는 화면 구성을 위한 데모용 가상 구성입니다.
      Prowler FAIL은 보안 설정 기준 미충족이며 공격 탐지나 침해 발생을 의미하지 않습니다.</span></div>`,
    donutCard('PASS / FAIL', '점검 결과 비율',
      ['FAIL', 'PASS'].map(k => ({ label: k, value: status[k] || 0, color: COLORS[k] })), '점검'),
    donutCard('Severity 분포', '전체 점검 기준',
      SEVERITIES.map(k => ({ label: k, value: severity[k] || 0, color: COLORS[k] })), '점검'),
    donutCard('AWS 리소스 유형', 'resources 테이블 기준', Object.entries(types).sort((a, b) => b[1] - a[1])
      .map(([k, v], i) => ({ label: TYPE_NAMES[k] || k, value: v, color: TYPE_COLORS[i % TYPE_COLORS.length] })), '리소스'),
    `<section class="card"><div class="card-head"><div><h2>AWS 아키텍처 구성도</h2>
      <p>DB의 resources · relationships를 조회해 실시간으로 생성 · 리소스 ${resources.length}개 · 관계 ${relationships.length}개</p></div>
      <div class="chips">
        <span class="chip"><i style="--c:#a855f7"></i>VPC</span>
        <span class="chip"><i style="--c:#22c55e"></i>Public Subnet</span>
        <span class="chip"><i style="--c:#3b82f6"></i>Private Subnet</span>
        <span class="chip">→ 리소스 간 관계</span>
      </div></div>
      <div class="diagram-wrap" id="diagram-wrap">
        <div class="canvas" id="diagram"><p>구성도 배치 중...</p></div>
        <aside class="status-panel"></aside>
        <svg class="leader" aria-hidden="true"></svg>
      </div></section>`,
  ].join('');

  const box = document.getElementById('diagram');
  const stats = findingStats(findings);
  try {
    box.innerHTML = await drawDiagram(resources, relationships, stats);
    attachStatusPanel(document.getElementById('diagram-wrap'), resources, stats, findingStats(
      findings.map(f => ({ ...f, resource_id: 'all' }))).all);
  } catch (e) {
    box.innerHTML = `<p class="error">구성도를 그리지 못했습니다: ${esc(e.message)}</p>`;
  }
}

// ---------------------------------------------------------------------------
// 구성도 보안 현황: 리소스별 FAIL/PASS·중요도 집계, 배지, 팝업
// ---------------------------------------------------------------------------

// resource_id별 집계. 리소스가 없는 점검(계정·리전 단위, 미연결)은 AWS Cloud(ROOT)로 묶습니다.
function findingStats(findings) {
  const stats = {};
  findings.forEach(f => {
    const key = f.resource_id || ROOT;
    const s = stats[key] = stats[key] || { fail: 0, pass: 0, sev: {} };
    if (f.status === 'FAIL') {
      s.fail += 1;
      s.sev[f.severity] = (s.sev[f.severity] || 0) + 1;
    } else if (f.status === 'PASS') {
      s.pass += 1;
    }
  });
  return stats;
}

const topSeverity = s => SEVERITIES.find(k => s.sev[k]);

// 노드·그룹 오른쪽 위 배지: FAIL 건수(가장 높은 중요도 색) 또는 전체 통과(초록 체크)
function statBadge(cx, cy, s) {
  if (!s || s.fail + s.pass === 0) return '';
  if (!s.fail) {
    return `<circle cx="${cx}" cy="${cy}" r="10" fill="${COLORS.PASS}"/>
      <path d="M${cx - 4} ${cy}l3 3 5-6" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>`;
  }
  return `<circle cx="${cx}" cy="${cy}" r="11" fill="${COLORS[topSeverity(s)] || COLORS.FAIL}" stroke="#0a0c10" stroke-width="2"/>
    <text x="${cx}" y="${cy + 4}" font-size="11" font-weight="700" fill="#fff" text-anchor="middle">${s.fail}</text>`;
}

// 패널 내용: 리소스(또는 전체)의 FAIL·PASS 건수와 중요도 분포
function statusHtml(name, kind, s, hint = '') {
  const head = `<div class="pop-head"><b>${esc(name)}</b><span>${esc(kind)}</span></div>`;
  const tail = hint ? `<p class="pop-hint">${esc(hint)}</p>` : '';
  if (!s || s.fail + s.pass === 0) return `${head}<p class="pop-empty">이 리소스에 연결된 점검 없음</p>${tail}`;
  const nums = `<div class="pop-nums">
    <div><small>FAIL</small><strong style="color:${COLORS.FAIL}">${s.fail}</strong></div>
    <div><small>PASS</small><strong style="color:${COLORS.PASS}">${s.pass}</strong></div></div>`;
  if (!s.fail) return `${head}${nums}<p class="pop-ok">모든 점검 통과</p>${tail}`;
  const bar = SEVERITIES.filter(k => s.sev[k]).map(k =>
    `<span style="flex:${s.sev[k]};background:${COLORS[k]}"></span>`).join('');
  const legend = SEVERITIES.filter(k => s.sev[k]).map(k =>
    `<span><i style="background:${COLORS[k]}"></i>${k} ${s.sev[k]}</span>`).join('');
  return `${head}${nums}<div class="pop-bar">${bar}</div><div class="pop-legend">${legend}</div>${tail}`;
}

// 구성도 오른쪽 고정 패널에 보안 현황을 표시하고, 선택한 노드에서 패널까지 연결선을 그립니다.
// 마우스를 올리면 임시 표시, 클릭하면 선택 고정, 빈 곳을 클릭하면 해제합니다.
function attachStatusPanel(wrap, resources, stats, total) {
  total = total || { fail: 0, pass: 0, sev: {} };
  const box = wrap.querySelector('.canvas');
  const panel = wrap.querySelector('.status-panel');
  const leader = wrap.querySelector('.leader');
  const byId = Object.fromEntries(resources.map(r => [r.resource_id, r]));
  let pinned = null, current = null;

  const lineColor = s => (!s || s.fail + s.pass === 0) ? '#8b93a7'
    : (s.fail ? COLORS[topSeverity(s)] || COLORS.FAIL : COLORS.PASS);

  const drawLine = () => {
    leader.innerHTML = '';
    const inner = box.querySelector('.leader-in');
    if (inner) inner.innerHTML = '';
    if (!current) return;
    const w = wrap.getBoundingClientRect(), c = box.getBoundingClientRect();
    const p = panel.getBoundingClientRect(), r = current.getBoundingClientRect();
    if (p.top >= c.bottom) return; // 좁은 화면: 패널이 아래로 내려가면 선을 그리지 않음
    const color = lineColor(stats[current.dataset.rid]);
    // 노드는 관계 화살표(노드 가운데 높이)와 겹치지 않도록 위쪽 1/4 높이에서 출발합니다.
    const sxScreen = Math.min(r.right, c.right);
    const syScreen = r.top + (current.classList.contains('hit') ? r.height / 2 : r.height * 0.24);

    // 캔버스 안쪽 구간: 구성도 SVG 좌표로 변환해 노드 아래 층에 그립니다.
    const diagram = box.querySelector('svg');
    if (inner && diagram) {
      const toSvg = (x, y) => {
        const pt = diagram.createSVGPoint();
        pt.x = x; pt.y = y;
        return pt.matrixTransform(diagram.getScreenCTM().inverse());
      };
      const a = toSvg(sxScreen, syScreen), b = toSvg(c.right, syScreen);
      inner.innerHTML = `<path d="M${a.x} ${a.y}H${b.x}" stroke="${color}" stroke-width="1.8"
        stroke-opacity="0.75" vector-effect="non-scaling-stroke"/>`;
    }

    // 캔버스 바깥 구간과 양 끝 점: 카드 위 투명 층에 그립니다.
    const sx = sxScreen - w.left, sy = syScreen - w.top, cx = c.right - w.left;
    const mx = (c.right + p.left) / 2 - w.left;
    const ex = p.left - w.left, ey = p.top + 30 - w.top;
    leader.innerHTML = `<path d="M${cx} ${sy}H${mx}V${ey}H${ex}" fill="none" stroke="${color}"
        stroke-width="1.8" stroke-opacity="0.75" stroke-linejoin="round"/>
      <circle cx="${sx}" cy="${sy}" r="4.5" fill="${color}"/><circle cx="${ex}" cy="${ey}" r="3" fill="${color}"/>`;
  };

  const showOverview = () => {
    panel.innerHTML = statusHtml('전체 보안 현황', `점검 ${total.fail + total.pass}건`, total,
      '리소스나 VPC·Subnet 이름에 마우스를 올리면 해당 리소스의 현황이 표시됩니다. 클릭하면 고정됩니다.');
    panel.style.borderColor = '';
  };

  const select = el => {
    wrap.querySelectorAll('.selected').forEach(n => n.classList.remove('selected'));
    current = el;
    if (!el) { showOverview(); drawLine(); return; }
    el.classList.add('selected');
    const rid = el.dataset.rid, res = byId[rid];
    panel.innerHTML = res
      ? statusHtml(res.resource_name, TYPE_NAMES[res.resource_type] || res.resource_type, stats[rid])
      : statusHtml('AWS Cloud', '리소스 미지정 점검', stats[ROOT]);
    panel.style.borderColor = lineColor(stats[rid]);
    drawLine();
  };

  box.querySelectorAll('[data-rid]').forEach(el => {
    el.addEventListener('mouseenter', () => { if (!pinned) select(el); });
    el.addEventListener('mouseleave', () => { if (!pinned) select(null); });
    el.addEventListener('click', e => {
      e.stopPropagation();
      pinned = pinned === el ? null : el;
      select(pinned || el);
    });
  });
  box.addEventListener('click', () => { pinned = null; select(null); });
  box.addEventListener('scroll', drawLine);
  window.addEventListener('resize', drawLine);
  select(null);
}

// ---------------------------------------------------------------------------
// AWS 구성도: DB 관계 → ELK 배치 → SVG
// ---------------------------------------------------------------------------

// 포함 관계: 부모 박스 안에 자식을 넣고, 나머지 관계는 화살표로 그립니다.
const CONTAINMENT = new Set(['contains', 'hosts']);
const ICONS = new Set(['vpc', 'subnet', 'alb', 'ec2-instance', 's3-bucket', 'cloudtrail-trail', 'iam-role']);
const ROOT = '__aws_cloud__';
const NODE_W = 150, NODE_H = 120, ICON = 44;
const GROUP_PAD = '[top=64,left=28,bottom=28,right=28]';

function groupStyle(res) {
  if (!res) return { color: '#8b93a7', icon: 'aws-cloud', kind: 'AWS Cloud', fill: 0.02 };
  if (res.resource_type === 'vpc') return { color: '#a855f7', icon: 'vpc', kind: 'VPC', fill: 0.05 };
  if (res.resource_type === 'subnet') {
    const isPublic = /public/i.test(res.resource_name);
    return { color: isPublic ? '#22c55e' : '#3b82f6', icon: 'subnet', kind: isPublic ? 'Public Subnet' : 'Private Subnet', fill: 0.06 };
  }
  return {
    color: '#8b93a7', icon: ICONS.has(res.resource_type) ? res.resource_type : null,
    kind: TYPE_NAMES[res.resource_type] || res.resource_type, fill: 0.04,
  };
}

// 이름을 하이픈 기준으로 줄바꿈해 노드 폭 안에 맞춥니다.
function wrapLabel(text, max = 18) {
  const lines = [];
  let line = '';
  text.split(/(?<=-)/).forEach(part => {
    if ((line + part).length > max && line) { lines.push(line); line = ''; }
    line += part;
  });
  if (line) lines.push(line);
  return lines.slice(0, 2);
}

async function drawDiagram(resources, relationships, stats) {
  if (typeof ELK === 'undefined') throw new Error('ELK.js를 불러오지 못했습니다(CDN 접속 확인).');
  if (!resources.length) return '<p>resources 테이블이 비어 있습니다.</p>';

  const byId = Object.fromEntries(resources.map(r => [r.resource_id, r]));
  const parent = {};
  const arrows = [];
  relationships.forEach(rel => {
    if (!byId[rel.source_id] || !byId[rel.target_id]) return;
    if (CONTAINMENT.has(rel.relation_type) && !parent[rel.target_id]) parent[rel.target_id] = rel.source_id;
    else arrows.push(rel);
  });
  // 포함 순환이 있으면 해당 연결을 끊어 무한 루프를 막습니다.
  Object.keys(parent).forEach(id => {
    const seen = new Set([id]);
    for (let p = parent[id]; p; p = parent[p]) {
      if (seen.has(p)) { delete parent[id]; break; }
      seen.add(p);
    }
  });

  const children = {};
  resources.forEach(r => {
    const p = parent[r.resource_id] || ROOT;
    (children[p] = children[p] || []).push(r.resource_id);
  });
  const isGroup = id => id === ROOT || Boolean(children[id]);

  const toElk = id => isGroup(id)
    ? { id, layoutOptions: { 'elk.padding': GROUP_PAD }, children: (children[id] || []).map(toElk), edges: [] }
    : { id, width: NODE_W, height: NODE_H };
  const graph = toElk(ROOT);

  // 화살표는 두 끝점의 가장 가까운 공통 부모에 선언합니다(좌표 기준이 그 부모가 됨).
  const ancestors = id => {
    const list = [id];
    while (list[list.length - 1] !== ROOT) list.push(parent[list[list.length - 1]] || ROOT);
    return list;
  };
  const elkNodes = {};
  (function index(n) { elkNodes[n.id] = n; (n.children || []).forEach(index); })(graph);
  arrows.forEach((rel, i) => {
    const up = new Set(ancestors(rel.source_id).slice(1));
    const lca = ancestors(rel.target_id).slice(1).find(a => up.has(a)) || ROOT;
    elkNodes[lca].edges.push({
      id: `e${i}`, sources: [rel.source_id], targets: [rel.target_id],
      labels: [{ text: rel.relation_type, width: rel.relation_type.length * 6.6 + 18, height: 20 }],
    });
  });

  const layout = await new ELK().layout({
    id: 'canvas',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.edgeLabels.placement': 'CENTER',
      'elk.spacing.nodeNode': '44',
      'elk.layered.spacing.nodeNodeBetweenLayers': '84',
      'elk.layered.spacing.edgeNodeBetweenLayers': '28',
      'elk.padding': '[top=16,left=4,bottom=4,right=16]',
    },
    children: [graph],
  });

  // ELK 좌표는 부모 기준 상대값이므로 절대 좌표로 바꾸면서 그립니다.
  const groups = [], nodes = [], edges = [];
  (function walk(n, ox, oy) {
    const x = ox + n.x, y = oy + n.y;
    if (n.children) groups.push({ n, x, y }); else nodes.push({ n, x, y });
    (n.edges || []).forEach(e => edges.push({ e, ox: x, oy: y }));
    (n.children || []).forEach(c => walk(c, x, y));
  })(layout.children[0], 0, 0);

  const svg = [];
  groups.forEach(({ n, x, y }) => {
    const res = byId[n.id];
    const st = groupStyle(res);
    const name = res ? res.resource_name : 'AWS Cloud';
    // 그룹 머리: 아이콘 + 이름(1행) + 종류(2행). 머리 영역에만 보안 현황 팝업을 연결합니다.
    svg.push(`<g>
      <rect x="${x}" y="${y}" width="${n.width}" height="${n.height}" rx="14"
        fill="${st.color}" fill-opacity="${st.fill}" stroke="${st.color}" stroke-opacity="${res ? 0.55 : 0.35}"
        stroke-width="1.5" ${res ? '' : 'stroke-dasharray="6 5"'}/>
      ${st.icon ? `<image href="icon-${st.icon}.svg" x="${x + 16}" y="${y + 16}" width="28" height="28" style="clip-path:inset(0 round 7px)"/>` : ''}
      <text x="${x + 54}" y="${y + 28}" font-size="13.5" font-weight="600" fill="#e6e8ee">${esc(name)}</text>
      ${res ? `<text x="${x + 54}" y="${y + 44}" font-size="11" fill="${st.color}">${esc(st.kind)}</text>` : ''}
      ${statBadge(x + n.width - 22, y, stats[n.id])}
      <rect class="hit" data-rid="${esc(n.id)}" x="${x}" y="${y}" width="${n.width}" height="56" rx="14" fill="transparent"/></g>`);
  });

  // 관계 라벨은 화살표에서 가장 긴 구간의 가운데에 표시합니다(ELK 라벨은 간격 확보용).
  const labels = [];
  edges.forEach(({ e, ox, oy }) => {
    (e.sections || []).forEach(s => {
      const pts = [s.startPoint, ...(s.bendPoints || []), s.endPoint].map(p => ({ x: ox + p.x, y: oy + p.y }));
      svg.push(`<polyline points="${pts.map(p => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="#5b6478"
        stroke-width="1.6" marker-end="url(#arrow)"><title>${esc(`${e.sources[0]} → ${e.targets[0]}`)}</title></polyline>`);
      let best = null;
      pts.slice(1).forEach((p, i) => {
        const len = Math.hypot(p.x - pts[i].x, p.y - pts[i].y);
        if (!best || len > best.len) best = { len, x: (p.x + pts[i].x) / 2, y: (p.y + pts[i].y) / 2 };
      });
      const l = (e.labels || [])[0];
      if (best && l) labels.push({ text: l.text, w: l.width, x: best.x - 4, y: best.y });
    });
  });
  labels.forEach(l => {
    svg.push(`<rect x="${l.x - l.w / 2}" y="${l.y - 10}" width="${l.w}" height="20" rx="10" fill="#11141a" stroke="#2e3542"/>
      <text x="${l.x}" y="${l.y + 4}" font-size="11" fill="#aab2c5" text-anchor="middle"
        font-family="ui-monospace, Menlo, monospace">${esc(l.text)}</text>`);
  });

  // 보안 현황 연결선의 캔버스 안쪽 구간(노드보다 아래 층)
  svg.push('<g class="leader-in"></g>');

  nodes.forEach(({ n, x, y }) => {
    const res = byId[n.id];
    const cx = x + NODE_W / 2;
    const iconY = y + 16;
    const img = ICONS.has(res.resource_type)
      ? `<image href="icon-${res.resource_type}.svg" x="${cx - ICON / 2}" y="${iconY}" width="${ICON}" height="${ICON}"
          style="clip-path:inset(0 round 10px)"/>`
      : `<rect x="${cx - ICON / 2}" y="${iconY}" width="${ICON}" height="${ICON}" rx="10" fill="#2e3542"/>`;
    const lines = wrapLabel(res.resource_name);
    const label = lines.map((line, i) => `<tspan x="${cx}" dy="${i ? 15 : 0}">${esc(line)}</tspan>`).join('');
    const typeY = iconY + ICON + 24 + (lines.length - 1) * 15 + 16;
    svg.push(`<g class="node" data-rid="${esc(res.resource_id)}">
      <rect class="tile" x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="12" fill="#161a22" stroke="#2a303c"/>
      ${img}
      <text x="${cx}" y="${iconY + ICON + 22}" font-size="12.5" font-weight="500" fill="#e6e8ee" text-anchor="middle">${label}</text>
      <text x="${cx}" y="${typeY}" font-size="10.5" fill="#8b93a7" text-anchor="middle">${esc(TYPE_NAMES[res.resource_type] || res.resource_type)}</text>
      ${statBadge(x + NODE_W - 6, y + 6, stats[res.resource_id])}</g>`);
  });

  const w = Math.ceil(layout.width), h = Math.ceil(layout.height);
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" role="img" aria-label="AWS 아키텍처 구성도" style="overflow:visible"
    font-family="Pretendard, Inter, 'Segoe UI', sans-serif">
    <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7"
      orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#5b6478"/></marker></defs>
    ${svg.join('\n')}</svg>`;
}

// ---------------------------------------------------------------------------
// 2페이지: 보안 점검 및 대응
// ---------------------------------------------------------------------------

const COLUMNS = [
  { key: 'finding_id', label: '점검 번호' },
  { key: 'resource_type', label: '리소스 종류' },
  { key: 'resource_name', label: '리소스 이름' },
  { key: 'title', label: '점검 항목' },
  { key: 'status', label: '점검 결과' },
  { key: 'severity', label: 'Severity' },
  { key: 'isms_p', label: 'ISMS-P' },
];
const view = { sortKey: null, asc: true, status: '전체', severity: '전체', query: '' };

function segment(name, options) {
  return `<div class="segment" data-filter="${name}">${options.map(o =>
    `<button type="button" class="${view[name] === o ? 'on' : ''}" data-value="${o}">${o}</button>`).join('')}</div>`;
}

async function renderSecurity() {
  const findings = await api('findings');
  setHeader('security', 'Prowler Findings', '보안 점검 및 대응');
  const status = countBy(findings, 'status');
  const pass = status.PASS || 0, fail = status.FAIL || 0;
  const urgent = findings.filter(f => f.status === 'FAIL' && ['Critical', 'High'].includes(f.severity)).length;

  app.innerHTML = [
    kpi({ label: '전체 점검', value: findings.length, sub: 'Prowler 보안 설정 점검', color: COLORS.info, iconName: 'check' }),
    kpi({ label: 'FAIL', value: fail, sub: `실패율 ${pct(fail, findings.length)}%`, color: COLORS.FAIL, iconName: 'fail', ratio: pct(fail, findings.length) }),
    kpi({ label: 'PASS', value: pass, sub: `통과율 ${pct(pass, findings.length)}%`, color: COLORS.PASS, iconName: 'pass', ratio: pct(pass, findings.length) }),
    kpi({ label: 'Critical / High FAIL', value: urgent, sub: '우선 조치 대상', color: COLORS.Critical, iconName: 'alert' }),
    `<section class="card"><div class="card-head"><div><h2>판정 및 중요도 안내</h2>
      <p>실제 AWS 계정의 Prowler 스캔에서 추린 보안 설정 점검 결과이며, 공격 탐지 결과가 아닙니다.</p></div></div>
      <div class="guide-row"><span class="guide-label">판정</span><div class="guide">
        <div>${badge('FAIL')}AWS 보안 점검 기준 미충족</div>
        <div>${badge('PASS')}AWS 보안 점검 기준 충족</div>
      </div></div>
      <div class="guide-row"><span class="guide-label">중요도</span><div class="guide">
        <div>${badge('Critical')}매우 높은 중요도</div>
        <div>${badge('High')}높은 중요도</div>
        <div>${badge('Medium')}중간 중요도</div>
        <div>${badge('Low')}낮은 중요도</div>
      </div></div></section>`,
    `<section class="card"><div class="card-head"><div><h2>보안 점검 목록</h2>
      <p id="count"></p></div>
      <div class="toolbar">
        <input class="search" id="search" type="search" placeholder="점검 항목, 리소스, 번호 검색" value="${esc(view.query === '' ? '' : view.query)}">
        ${segment('status', ['전체', 'FAIL', 'PASS'])}
        ${segment('severity', ['전체', ...SEVERITIES])}
      </div></div>
      <div class="table-wrap"><table><thead><tr>${COLUMNS.map(c =>
        `<th data-key="${c.key}">${c.label}<span class="arrow"></span></th>`).join('')}</tr></thead>
      <tbody id="rows"></tbody></table></div></section>`,
  ].join('');

  const fillRows = () => {
    const q = view.query.trim().toLowerCase();
    const rows = findings.filter(f =>
      (view.status === '전체' || f.status === view.status)
      && (view.severity === '전체' || f.severity === view.severity)
      && (!q || [f.finding_id, f.title, f.resource_name, tagLabel(f.resource_type), f.isms_p]
        .some(v => String(v).toLowerCase().includes(q))));
    if (view.sortKey) {
      const key = f => (view.sortKey === 'resource_type' ? tagLabel(f.resource_type) : f[view.sortKey]);
      rows.sort((a, b) => String(key(a)).localeCompare(String(key(b)), 'ko', { numeric: true })
        * (view.asc ? 1 : -1));
    }
    document.getElementById('count').textContent = `${rows.length}건 표시 · 행을 클릭하면 상세보기`;
    document.getElementById('rows').innerHTML = rows.length ? rows.map(f => `
      <tr data-id="${esc(f.finding_id)}">
        <td class="id">${esc(f.finding_id)}</td>
        <td>${resourceTag(f.resource_type)}</td>
        <td class="target">${resourceName(f)}</td>
        <td class="title">${esc(f.title)}</td>
        <td>${badge(f.status)}</td>
        <td>${badge(f.severity)}</td>
        <td>${codes(f.isms_p)}</td>
      </tr>`).join('') : `<tr><td colspan="${COLUMNS.length}" class="empty">조건에 맞는 점검이 없습니다.</td></tr>`;
    document.querySelectorAll('th').forEach(th => {
      th.querySelector('.arrow').textContent = th.dataset.key === view.sortKey ? (view.asc ? '↑' : '↓') : '';
    });
  };

  document.querySelectorAll('th').forEach(th => th.addEventListener('click', () => {
    view.asc = view.sortKey === th.dataset.key ? !view.asc : true;
    view.sortKey = th.dataset.key;
    fillRows();
  }));
  document.querySelectorAll('.segment').forEach(seg => seg.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    view[seg.dataset.filter] = btn.dataset.value;
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === btn));
    fillRows();
  }));
  document.getElementById('search').addEventListener('input', e => { view.query = e.target.value; fillRows(); });
  document.getElementById('rows').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) location.hash = 'finding/' + encodeURIComponent(tr.dataset.id);
  });
  fillRows();
}

// ---------------------------------------------------------------------------
// 상세보기
// ---------------------------------------------------------------------------

async function renderDetail(id) {
  const q = 'finding_id=eq.' + encodeURIComponent(id);
  const [[f], [d]] = await Promise.all([api('findings?' + q), api('finding_details?' + q)]);
  setHeader('security', 'Finding Detail', '점검 상세보기');
  if (!f) {
    app.innerHTML = `<p class="error">점검 번호 ${esc(id)}를 찾을 수 없습니다.</p>`;
    return;
  }
  const section = (title, body, color, span) => `<section class="card section ${span}" style="--c:${color}">
    <h3><i></i>${title}</h3><div class="content">${body}</div></section>`;
  app.innerHTML = [
    `<section class="card detail-head">
      <a class="back" href="#security">← 보안 점검 목록</a>
      <h2>${esc(f.title)}</h2>
      <div class="meta">${badge(f.status)}${badge(f.severity)}
        <span>점검 번호 <b>${esc(f.finding_id)}</b></span>
        <span class="meta-resource">점검 대상 ${resourceTag(f.resource_type)}<b>${resourceName(f)}</b></span></div></section>`,
    section('점검 결과', esc(d?.status_detail), COLORS[f.status] || COLORS.info, 'span-6'),
    section('보안 위험', esc(d?.risk_details), COLORS[f.severity] || COLORS.FAIL, 'span-6'),
    section('AWS 개선 권고', esc(d?.remediation), COLORS.PASS, ''),
    section('ISMS-P 매핑', codes(f.isms_p), COLORS.accent, ''),
  ].join('');
}

// ---------------------------------------------------------------------------
// 라우팅: #architecture, #security, #finding/<id>
// ---------------------------------------------------------------------------

async function route() {
  const hash = decodeURIComponent(location.hash.slice(1));
  app.innerHTML = '<p class="loading">불러오는 중...</p>';
  try {
    if (hash.startsWith('finding/')) await renderDetail(hash.slice('finding/'.length));
    else if (hash === 'security') await renderSecurity();
    else await renderArchitecture();
  } catch (e) {
    app.innerHTML = `<p class="error">데이터를 불러오지 못했습니다: ${esc(e.message)}</p>`;
  }
  window.scrollTo(0, 0);
}

document.getElementById('refresh').addEventListener('click', route);
window.addEventListener('hashchange', route);
route();
