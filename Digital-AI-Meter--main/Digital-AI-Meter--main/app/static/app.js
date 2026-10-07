let resource;
let readings=[];
let detectedAnomalies=[];
let forecast=[];
let insightText='';
let recommendationText='';
let requestVersion=0;
let activeRange={start:null,end:null,rows:[]};
let currentPage='';

const $=id=>document.getElementById(id);
const unit=()=>resource==='electricity'?'kWh':'L';
const parseTimestamp=value=>new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(value)?value:`${value}Z`);
const datePart=value=>value.slice(0,10);
const dateAtUtcOffset=(value,offset)=>new Date(`${value}T00:00:00Z`).getTime()+offset*86400000;

function readPreference(key,fallback){
    try{
        return localStorage.getItem(key)||fallback;
    }catch(error){
        console.error(`Could not read saved preference "${key}":`,error);
        return fallback;
    }
}

function savePreference(key,value){
    try{
        localStorage.setItem(key,value);
    }catch(error){
        console.error(`Could not save preference "${key}":`,error);
    }
}

resource=readPreference('meter-resource','electricity')==='water'?'water':'electricity';

const pages={
    dashboard:{title:'Dashboard',description:'A simple overview of your electricity and water usage.'},
    'usage-analytics':{title:'Usage Analytics',description:'Filter meter readings, review trends, and compare periods.'},
    'ai-insights':{title:'AI Insights',description:'Review forecasts, meter patterns, and appliance estimates.'},
    alerts:{title:'Alerts',description:'Review unusual readings and tune which alerts are displayed.'},
    reports:{title:'Reports',description:'Export readings for a selected date range.'}
};

function route(){
    let name=window.location.hash.slice(1);
    if(!pages[name]) name='dashboard';
    let pageChanged=currentPage!==name;
    Object.keys(pages).forEach(key=>{
        let page=$(`page-${key}`);
        let active=key===name;
        page.hidden=!active;
        page.classList.toggle('active-page',active);
        if(active){
            page.classList.remove('page-enter');
            void page.offsetWidth;
            page.classList.add('page-enter');
        }
    });
    document.querySelectorAll('nav a').forEach(link=>{
        let active=link.getAttribute('href')===`#${name}`;
        link.classList.toggle('active',active);
        if(active) link.setAttribute('aria-current','page');
        else link.removeAttribute('aria-current');
    });
    $('page-title').textContent=pages[name].title;
    $('page-description').textContent=pages[name].description;
    $('sidebar').classList.remove('mobile-open');
    $('sidebar-backdrop').hidden=true;
    document.body.classList.remove('nav-open');
    $('menu-toggle').setAttribute('aria-expanded','false');
    $('menu-toggle').setAttribute('aria-label','Open navigation');
    if(pageChanged){
        currentPage=name;
        window.scrollTo({top:0,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
        $('page-title').focus({preventScroll:true});
    }
}

window.addEventListener('hashchange',route);
route();

$('menu-toggle').addEventListener('click',()=>{
    let open=$('sidebar').classList.toggle('mobile-open');
    $('sidebar-backdrop').hidden=!open;
    document.body.classList.toggle('nav-open',open);
    $('menu-toggle').setAttribute('aria-expanded',String(open));
    $('menu-toggle').setAttribute('aria-label',open?'Close navigation':'Open navigation');
});
$('sidebar-backdrop').addEventListener('click',()=>{
    $('sidebar').classList.remove('mobile-open');
    $('sidebar-backdrop').hidden=true;
    document.body.classList.remove('nav-open');
    $('menu-toggle').setAttribute('aria-expanded','false');
    $('menu-toggle').setAttribute('aria-label','Open navigation');
});
document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&$('sidebar').classList.contains('mobile-open')){
        $('sidebar').classList.remove('mobile-open');
        $('sidebar-backdrop').hidden=true;
        document.body.classList.remove('nav-open');
        $('menu-toggle').setAttribute('aria-expanded','false');
        $('menu-toggle').setAttribute('aria-label','Open navigation');
        $('menu-toggle').focus();
    }
});

async function get(path){
    let response=await fetch(path);
    if(!response.ok) throw new Error(`Request failed (${response.status}): ${path}`);
    return response.json();
}

async function load(){
    let version=++requestVersion;
    $('load-error').hidden=true;
    try{
        let [summary,data,anomalies,insight,predictions,health]=await Promise.all([
            get(`/summary?resource=${resource}`),
            get(`/meter-data?resource=${resource}`),
            get(`/anomalies?resource=${resource}`),
            get(`/ai-insight?resource=${resource}`),
            get(`/prediction?resource=${resource}`),
            get('/health')
        ]);
        if(version!==requestVersion) return;
        readings=data;
        detectedAnomalies=anomalies;
        forecast=predictions;
        insightText=insight.insight;
        recommendationText=(await get(`/recommendation?resource=${resource}`)).recommendation;
        if(version!==requestVersion) return;

        $('cur').textContent=Number(summary.current).toFixed(2);
        $('avg').textContent=Number(summary.average).toFixed(2);
        $('peak').textContent=Number(summary.peak).toFixed(2);
        $('ac').textContent=anomalies.length;
        $('u').textContent=resource==='electricity'?'kWh per reading':'L per reading';
        $('e').classList.toggle('active',resource==='electricity');
        $('w').classList.toggle('active',resource==='water');
        $('e').setAttribute('aria-pressed',String(resource==='electricity'));
        $('w').setAttribute('aria-pressed',String(resource==='water'));
        $('insight').textContent=insightText;
        $('recommendation').textContent=recommendationText;
        $('detection-method').textContent=health.model||'Anomaly detector';

        renderRange();
        renderEnergyInsights();
        renderAlerts();
        renderReport();
    }catch(error){
        if(version!==requestVersion) return;
        $('load-error').textContent=`Could not load meter data. ${error.message}`;
        $('load-error').hidden=false;
        console.error('Dashboard data load failed:',error);
    }
}

function setResource(next){
    if(resource===next) return;
    resource=next;
    savePreference('meter-resource',resource);
    load();
}
$('e').addEventListener('click',()=>setResource('electricity'));
$('w').addEventListener('click',()=>setResource('water'));

function groupedByDay(data){
    let days=new Map();
    data.forEach(row=>{
        let day=datePart(row.timestamp);
        let entry=days.get(day)||{total:0,count:0};
        entry.total+=Number(row.consumption);
        entry.count+=1;
        days.set(day,entry);
    });
    return days;
}

function getRangeRows(){
    let preset=$('date-range').value;
    let availableDays=[...new Set(readings.map(row=>datePart(row.timestamp)))].sort();
    if(!availableDays.length) return {rows:[],start:null,end:null};

    let end=preset==='custom'?$('date-to').value:availableDays.at(-1);
    let start;
    if(preset==='custom'){
        start=$('date-from').value;
    }else if(preset==='all'){
        start=availableDays[0];
        end=availableDays.at(-1);
    }else{
        start=new Date(dateAtUtcOffset(end,-(Number(preset)-1))).toISOString().slice(0,10);
    }

    if(!start||!end||start>end){
        throw new Error('Choose a valid start and end date.');
    }
    return {start,end,rows:readings.filter(row=>{
        let day=datePart(row.timestamp);
        return day>=start&&day<=end;
    })};
}

function updateDateControls(){
    let custom=$('date-range').value==='custom';
    document.querySelectorAll('.custom-date').forEach(label=>label.hidden=!custom);
    $('range-error').hidden=true;
}
$('date-range').addEventListener('change',updateDateControls);
$('apply-range').addEventListener('click',renderRange);

function renderRange(){
    let range;
    try{
        range=getRangeRows();
    }catch(error){
        $('range-error').textContent=error.message;
        $('range-error').hidden=false;
        return;
    }
    $('range-error').hidden=true;
    activeRange=range;
    savePreference('meter-range',JSON.stringify({
        period:$('date-range').value,
        start:$('date-from').value,
        end:$('date-to').value
    }));
    let rows=range.rows;
    let total=rows.reduce((sum,row)=>sum+Number(row.consumption),0);
    $('period-total').textContent=`${total.toFixed(2)} ${unit()}`;
    $('period-label').textContent=range.start?`${range.start} to ${range.end}`:'No available readings';
    $('reading-count').textContent=rows.length;
    $('analytics-chart-caption').textContent=rows.length
        ? `${rows.length} readings from ${range.start} to ${range.end}`
        : 'No readings in the selected date range.';

    let previous=null;
    if(range.start&&range.end&&$('date-range').value!=='all'){
        let duration=Math.round((dateAtUtcOffset(range.end,0)-dateAtUtcOffset(range.start,0))/86400000)+1;
        let previousEnd=new Date(dateAtUtcOffset(range.start,-1)).toISOString().slice(0,10);
        let previousStart=new Date(dateAtUtcOffset(previousEnd,-(duration-1))).toISOString().slice(0,10);
        let timeCutoff=rows.at(-1)?.timestamp.slice(11,16)||'23:59';
        previous=readings.filter(row=>{
            let day=datePart(row.timestamp);
            return day>=previousStart&&day<=previousEnd&&
                (day!==previousEnd||row.timestamp.slice(11,16)<=timeCutoff);
        });
    }
    let previousTotal=previous?previous.reduce((sum,row)=>sum+Number(row.consumption),0):null;
    $('previous-total').textContent=previous===null||!previous.length?'—':`${previousTotal.toFixed(2)} ${unit()}`;
    $('previous-label').textContent=previous===null
        ?'No previous period for this selection'
        :previous.length?`${previous.length} readings`:'No readings in previous period';
    let percentChange=previousTotal?((total-previousTotal)/previousTotal)*100:null;
    let normalizedChange=percentChange!==null&&Math.abs(percentChange)<0.05?0:percentChange;
    $('period-change').textContent=percentChange===null||!previous?.length
        ?'—'
        :`${normalizedChange>0?'+':''}${normalizedChange.toFixed(1)}%`;
    chart(rows);
    slots(rows);
    renderReport();
}

function chart(data){
    let svg=document.querySelector('#chart svg');
    if(!data.length){
        svg.innerHTML='<text x="450" y="150" text-anchor="middle" fill="#718096" font-size="14">No readings for this date range</text>';
        return;
    }
    let values=data.map(row=>Number(row.consumption));
    let width=900,height=300,left=66,right=20,top=20,bottom=48;
    let plotWidth=width-left-right,plotHeight=height-top-bottom;
    let maxValue=Math.max(...values,0);
    let rawStep=maxValue/5||1;
    let magnitude=10**Math.floor(Math.log10(rawStep));
    let step=[1,2,5,10].map(value=>value*magnitude).find(value=>value>=rawStep);
    let maxY=step*5;
    let xAt=index=>left+index*plotWidth/Math.max(1,values.length-1);
    let yAt=value=>top+plotHeight-(value/maxY)*plotHeight;
    let line=values.map((value,index)=>`${index?'L':'M'}${xAt(index)} ${yAt(value)}`).join(' ');
    let grid=Array.from({length:6},(_,index)=>{
        let value=index*step,y=yAt(value);
        return `<path d="M${left} ${y} H${width-right}" stroke="#e8edf4"/>`+
            `<text x="${left-10}" y="${y+4}" text-anchor="end" fill="#718096" font-size="11">${Number(value.toPrecision(4))}</text>`;
    }).join('');
    let tickCount=Math.min(5,data.length);
    let dateTicks=Array.from({length:tickCount},(_,tick)=>{
        let index=Math.round(tick*(data.length-1)/Math.max(1,tickCount-1));
        let x=xAt(index);
        let date=parseTimestamp(`${datePart(data[index].timestamp)}T12:00:00Z`);
        let label=date.toLocaleDateString(undefined,{month:'short',day:'numeric',timeZone:'UTC'});
        return `<path d="M${x} ${top+plotHeight} V${top+plotHeight+5}" stroke="#aeb8c6"/>`+
            `<text x="${x}" y="${height-23}" text-anchor="middle" fill="#718096" font-size="11">${label}</text>`;
    }).join('');
    svg.innerHTML=`<text x="${left}" y="12" fill="#718096" font-size="11">Consumption (${unit()})</text>`+
        grid+`<path d="M${left} ${top} V${top+plotHeight} H${width-right}" fill="none" stroke="#aeb8c6"/>`+
        dateTicks+`<text x="${left+plotWidth/2}" y="${height-3}" text-anchor="middle" fill="#718096" font-size="11">Date</text>`+
        `<path d="${line}" fill="none" stroke="#3277df" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function slots(data){
    let bins=[[],[],[],[]];
    data.forEach(row=>{
        let hour=parseTimestamp(row.timestamp).getUTCHours();
        bins[hour<6?0:hour<12?1:hour<18?2:3].push(Number(row.consumption));
    });
    ['n','m','a','ev'].forEach((id,index)=>{
        let average=bins[index].length
            ?bins[index].reduce((sum,value)=>sum+value,0)/bins[index].length:0;
        $(id).textContent=`${average.toFixed(2)} ${unit()}`;
    });
}

function median(values){
    if(!values.length) return null;
    let sorted=[...values].sort((a,b)=>a-b);
    return sorted[Math.floor(sorted.length/2)];
}

function compareWithTypical(reading,excludedAnomalyTimes){
    let when=parseTimestamp(reading.timestamp);
    let typical=median(readings.filter(candidate=>
        !excludedAnomalyTimes.has(candidate.timestamp)&&
        parseTimestamp(candidate.timestamp).getUTCHours()===when.getUTCHours()&&
        parseTimestamp(candidate.timestamp).getTime()<when.getTime()
    ).map(candidate=>Number(candidate.consumption)));
    return typical&&typical>0
        ?Math.round((Number(reading.consumption)-typical)/typical*100)
        :null;
}

function renderApplianceEstimates(monthlyUsage){
    let inputs=[...document.querySelectorAll('.appliance-share')];
    let total=inputs.reduce((sum,input)=>sum+(input.valueAsNumber||0),0);
    inputs.forEach(input=>{
        let share=input.valueAsNumber;
        let output=input.parentElement.querySelector('.appliance-track i');
        let percent=Number.isFinite(share)?Math.max(0,Math.min(100,share)):0;
        output.style.width=`${percent}%`;
        output.title=`${percent}%`;
    });
    $('appliance-total').textContent=`Total: ${total}%`;
    $('appliance-total').classList.toggle('field-error-text',total!==100);
    $('appliance-energy').textContent=total===100
        ?`Estimated monthly split: ${inputs.map(input=>`${input.dataset.appliance} ${(monthlyUsage*(input.valueAsNumber||0)/100).toFixed(1)} ${unit()}`).join(' • ')}.`
        :'Save a 100% total to see the estimated appliance usage split.';
}

function anomalyDetails(){
    let excluded=new Set(detectedAnomalies.map(item=>item.timestamp));
    return detectedAnomalies.map(reading=>({
        ...reading,
        aboveTypical:compareWithTypical(reading,excluded)
    }));
}

function renderEnergyInsights(){
    let isElectricity=resource==='electricity';
    $('bill-metric').hidden=!isElectricity;
    $('rate-control').hidden=!isElectricity;
    document.querySelector('.appliance-list').closest('article').hidden=!isElectricity;
    if(!readings.length) return;

    let daily=groupedByDay(readings);
    let completeDays=[...daily.entries()].filter(([,day])=>day.count>=24);
    let latestFullDay=completeDays.at(-1)||[...daily.entries()].at(-1);
    let latestDay=latestFullDay?.[1].total||0;
    let previousDays=completeDays.slice(0,-1).map(([,day])=>day.total);
    let baseline=previousDays.length
        ?previousDays.reduce((sum,value)=>sum+value,0)/previousDays.length:latestDay;
    let change=baseline?((latestDay-baseline)/baseline)*100:0;
    let score=Math.max(0,Math.min(100,Math.round(100-Math.max(0,change)*1.5)));
    let fullDayTotals=completeDays.map(([,day])=>day.total);
    let dailyAverage=fullDayTotals.length
        ?fullDayTotals.reduce((sum,value)=>sum+value,0)/fullDayTotals.length:latestDay;
    let monthlyUsage=dailyAverage*30;

    $('energy-score').textContent=score;
    $('score-ring').style.setProperty('--score',`${score*3.6}deg`);
    $('score-explanation').textContent=baseline
        ?`Latest complete day's consumption is ${Math.abs(Math.round(change))}% ${change>0?'above':'below'} the previous days' average.`
        :'Not enough readings to compare daily usage.';
    $('current-power').textContent=`${Number(readings.at(-1).consumption).toFixed(2)} ${unit()} per reading`;
    let latestDate=parseTimestamp(`${latestFullDay[0]}T12:00:00Z`)
        .toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
    $('day-total-label').textContent=`Latest complete day (${latestDate})`;
    $('day-total').textContent=`${latestDay.toFixed(2)} ${unit()}`;
    $('month-usage').textContent=`${monthlyUsage.toFixed(1)} ${unit()}`;
    let rate=$('energy-rate').valueAsNumber;
    $('month-bill').textContent=isElectricity&&Number.isFinite(rate)&&rate>=0
        ?`₹${(monthlyUsage*rate).toFixed(0)}`:'Enter a valid rate';
    $('prediction').replaceChildren();
    forecast.forEach((point,index)=>{
        let item=document.createElement('div');
        item.className='prediction-item';
        let label=document.createElement('span');
        label.textContent=`+${index+1} hr`;
        let value=document.createElement('b');
        value.textContent=`${Number(point.predicted).toFixed(2)} ${unit()}`;
        item.append(label,value);
        $('prediction').append(item);
    });
    $('insight').textContent=insightText;
    $('recommendation').textContent=recommendationText;
    renderApplianceEstimates(monthlyUsage);

    let latestAnomaly=anomalyDetails().at(-1);
    $('dashboard-alert').textContent=latestAnomaly
        ?`Unusual ${resource} reading at ${parseTimestamp(latestAnomaly.timestamp).toLocaleString(undefined,{timeZone:'UTC'})}: ${latestAnomaly.consumption} ${unit()}${latestAnomaly.aboveTypical===null?'':`, ${latestAnomaly.aboveTypical}% above typical usage at that hour`}.`
        :'No unusual readings detected.';
}

function loadApplianceShares(){
    const defaults=[38,18,12,32];
    try{
        let saved=JSON.parse(readPreference('meter-appliance-shares','null'));
        let values=Array.from(document.querySelectorAll('.appliance-share'));
        if(Array.isArray(saved)&&saved.length===values.length&&saved.every(value=>Number.isFinite(value)&&value>=0&&value<=100)){
            values.forEach((input,index)=>input.value=saved[index]);
        }else{
            values.forEach((input,index)=>input.value=defaults[index]);
        }
    }catch(error){
        console.error('Could not restore appliance estimates:',error);
    }
    updateApplianceShares();
}

function updateApplianceShares(){
    let monthly=Number.parseFloat($('month-usage').textContent);
    renderApplianceEstimates(Number.isFinite(monthly)?monthly:0);
}

document.querySelectorAll('.appliance-share').forEach(input=>{
    input.addEventListener('input',updateApplianceShares);
});
$('save-appliances').addEventListener('click',()=>{
    let inputs=[...document.querySelectorAll('.appliance-share')];
    let shares=inputs.map(input=>input.valueAsNumber);
    if(shares.some(value=>!Number.isFinite(value)||value<0||value>100)||shares.reduce((sum,value)=>sum+value,0)!==100){
        $('appliance-status').textContent='Enter percentages from 0 to 100 that add up to exactly 100%.';
        return;
    }
    try{
        savePreference('meter-appliance-shares',JSON.stringify(shares));
        $('appliance-status').textContent='Appliance split saved on this device.';
        updateApplianceShares();
    }catch(error){
        $('appliance-status').textContent='Could not save appliance split in this browser.';
        console.error('Could not save appliance estimates:',error);
    }
});
loadApplianceShares();

function renderAlerts(){
    let details=anomalyDetails();
    $('detected-count').textContent=details.length;
    let threshold=$('alert-threshold').valueAsNumber;
    let severity=$('alert-severity').value;
    let matches=details.filter(item=>{
        let severityMatch=severity==='all'||item.severity===severity;
        let thresholdMatch=item.aboveTypical===null||item.aboveTypical>=threshold;
        return severityMatch&&thresholdMatch;
    });
    $('filtered-count').textContent=matches.length;
    let list=$('alerts');
    list.replaceChildren();
    if(!matches.length){
        let empty=document.createElement('p');
        empty.className='empty-state';
        empty.textContent=details.length?'No detected alerts match these filters.':'No unusual patterns were detected in the available readings.';
        list.append(empty);
        return;
    }
    matches.slice().reverse().forEach(item=>{
        let card=document.createElement('div');
        card.className='al';
        let heading=document.createElement('b');
        heading.textContent=`⚠ Unusual ${resource} usage`;
        let detail=document.createElement('small');
        let increase=item.aboveTypical===null
            ?'same-hour baseline unavailable'
            :`${item.aboveTypical}% above typical for that hour`;
        detail.textContent=`${parseTimestamp(item.timestamp).toLocaleString(undefined,{timeZone:'UTC'})} • ${item.consumption} ${unit()} • ${item.severity} priority • ${increase}`;
        card.append(heading,document.createElement('br'),detail);
        list.append(card);
    });
}

$('apply-alert-filter').addEventListener('click',()=>{
    let value=$('alert-threshold').valueAsNumber;
    if(!Number.isFinite(value)||value<0||value>10000){
        $('alert-filter-error').textContent='Enter a threshold from 0 to 10,000%.';
        $('alert-filter-error').hidden=false;
        return;
    }
    $('alert-filter-error').hidden=true;
    savePreference('meter-alert-threshold',String(value));
    savePreference('meter-alert-severity',$('alert-severity').value);
    renderAlerts();
});

function renderReport(){
    $('report-resource').textContent=resource==='electricity'?'Electricity':'Water';
    $('report-period').textContent=activeRange.start
        ?`${activeRange.start} to ${activeRange.end}`:'No readings';
    $('report-count').textContent=activeRange.rows.length;
    let total=activeRange.rows.reduce((sum,row)=>sum+Number(row.consumption),0);
    $('report-total').textContent=`${total.toFixed(2)} ${unit()}`;
    let anomalies=new Set(detectedAnomalies.map(item=>item.timestamp));
    let alertCount=activeRange.rows.filter(row=>anomalies.has(row.timestamp)).length;
    $('report-alerts').textContent=`${alertCount} unusual ${alertCount===1?'reading':'readings'}`;
    let preview=$('report-preview');
    preview.replaceChildren();
    if(!activeRange.rows.length){
        let row=document.createElement('tr');
        let cell=document.createElement('td');
        cell.colSpan=4;
        cell.textContent='No readings in this period. Select a date range with available data.';
        row.append(cell);
        preview.append(row);
    }else{
        activeRange.rows.slice(-8).reverse().forEach(reading=>{
            let row=document.createElement('tr');
            let anomaly=anomalies.has(reading.timestamp);
            let values=[
                parseTimestamp(reading.timestamp).toLocaleString(undefined,{timeZone:'UTC'}),
                resource==='electricity'?'Electricity':'Water',
                `${Number(reading.consumption).toFixed(3)} ${unit()}`,
                anomaly?'Unusual reading':'Within expected range'
            ];
            values.forEach((value,index)=>{
                let cell=document.createElement('td');
                cell.textContent=value;
                if(index===3) cell.className=anomaly?'status-anomaly':'status-normal';
                row.append(cell);
            });
            preview.append(row);
        });
    }
    $('report-preview-note').textContent=activeRange.rows.length
        ?`Showing the latest ${Math.min(8,activeRange.rows.length)} of ${activeRange.rows.length} readings. The PDF includes every reading in the selected period.`
        :'There are no readings available to export for this date range.';
}

function pdfSafeText(value){
    return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'')
        .replace(/[^\x20-\x7E]/g,'?').replace(/\\/g,'\\\\')
        .replace(/\(/g,'\\(').replace(/\)/g,'\\)');
}

function pdfText(text,x,y,size=9,font='F1',color='0.15 0.20 0.29'){
    return `${color} rg BT /${font} ${size} Tf ${x} ${y} Td (${pdfSafeText(text)}) Tj ET`;
}

function createPdf(summary,rows){
    const pageWidth=612,pageHeight=792;
    let pages=[];
    let rowIndex=0;
    while(rowIndex<rows.length){
        let commands=[];
        commands.push('0.96 0.97 0.99 rg 0 735 612 57 re f');
        commands.push(pdfText('DIGITAL AI METER',40,766,9,'F2','0.12 0.36 0.76'));
        commands.push(pdfText('METER USAGE REPORT',40,741,19,'F2'));
        commands.push(pdfText(`${summary.resource}  |  ${summary.start} to ${summary.end}`,40,714,9));
        let firstPage=pages.length===0;
        let tableTop=firstPage?616:694;
        if(firstPage){
            commands.push('0.95 0.97 1 rg 40 638 532 46 re f');
            commands.push(pdfText(`TOTAL CONSUMPTION   ${summary.total} ${summary.unit}`,52,664,10,'F2'));
            commands.push(pdfText(`READINGS   ${summary.count}       UNUSUAL READINGS   ${summary.alerts}`,52,646,9));
            commands.push(pdfText(`Average ${summary.average} ${summary.unit} per reading     Peak ${summary.peak} ${summary.unit}`,40,622,9));
        }
        commands.push('0.12 0.36 0.76 rg 40 '+(tableTop-10)+' 532 22 re f');
        commands.push(pdfText('TIMESTAMP (UTC)',48,tableTop-3,8,'F2','1 1 1'));
        commands.push(pdfText('RESOURCE',252,tableTop-3,8,'F2','1 1 1'));
        commands.push(pdfText('CONSUMPTION',336,tableTop-3,8,'F2','1 1 1'));
        commands.push(pdfText('STATUS',449,tableTop-3,8,'F2','1 1 1'));
        let maxRows=firstPage?27:34;
        let pageRows=rows.slice(rowIndex,rowIndex+maxRows);
        pageRows.forEach((reading,index)=>{
            let y=tableTop-30-index*17;
            if(index%2===0) commands.push(`0.97 0.98 0.99 rg 40 ${y-4} 532 17 re f`);
            commands.push(pdfText(reading.timestamp.replace('T',' '),48,y,7));
            commands.push(pdfText(summary.resource,252,y,8));
            commands.push(pdfText(`${Number(reading.consumption).toFixed(3)} ${summary.unit}`,336,y,8));
            commands.push(pdfText(summary.anomalyTimes.has(reading.timestamp)?'Anomaly':'Normal',449,y,8,
                'F1',summary.anomalyTimes.has(reading.timestamp)?'0.72 0.30 0.12':'0.12 0.53 0.36'));
            commands.push('0.90 0.92 0.95 RG 0.4 w 40 '+(y-5)+' m 572 '+(y-5)+' l S');
        });
        rowIndex+=pageRows.length;
        commands.push('0.82 0.85 0.89 RG 0.6 w 40 38 m 572 38 l S');
        commands.push(pdfText('Generated from the available meter readings. Forecasts and estimates are not utility bills.',40,23,7,'F1','0.40 0.45 0.53'));
        commands.push(pdfText(`Page ${pages.length+1}`,530,23,7,'F1','0.40 0.45 0.53'));
        pages.push(commands.join('\n'));
    }

    let objects=[];
    let pageObjectIds=pages.map((_,index)=>5+index*2);
    objects[1]='<< /Type /Catalog /Pages 2 0 R >>';
    objects[2]=`<< /Type /Pages /Kids [${pageObjectIds.map(id=>`${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
    objects[3]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
    objects[4]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';
    pages.forEach((content,index)=>{
        let pageId=pageObjectIds[index];
        let contentId=pageId+1;
        objects[pageId]=`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
        objects[contentId]=`<< /Length ${new TextEncoder().encode(content).length} >>\nstream\n${content}\nendstream`;
    });
    let pdf='%PDF-1.4\n';
    let offsets=[0];
    for(let id=1;id<objects.length;id++){
        offsets[id]=new TextEncoder().encode(pdf).length;
        pdf+=`${id} 0 obj\n${objects[id]}\nendobj\n`;
    }
    let xrefOffset=new TextEncoder().encode(pdf).length;
    pdf+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for(let id=1;id<objects.length;id++) pdf+=`${String(offsets[id]).padStart(10,'0')} 00000 n \n`;
    pdf+=`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return new TextEncoder().encode(pdf);
}

$('download-report').addEventListener('click',()=>{
    if(!activeRange.rows.length){
        $('report-status').textContent='There are no readings in this period to export. Choose a date range with meter data first.';
        return;
    }
    try{
        let values=activeRange.rows.map(row=>Number(row.consumption));
        let anomalies=new Set(detectedAnomalies.map(item=>item.timestamp));
        let pdf=createPdf({
            resource:resource==='electricity'?'Electricity':'Water',
            start:activeRange.start,
            end:activeRange.end,
            total:values.reduce((sum,value)=>sum+value,0).toFixed(2),
            average:(values.reduce((sum,value)=>sum+value,0)/values.length).toFixed(2),
            peak:Math.max(...values).toFixed(2),
            count:values.length,
            alerts:activeRange.rows.filter(row=>anomalies.has(row.timestamp)).length,
            unit:unit(),
            anomalyTimes:anomalies
        },activeRange.rows);
        let url=URL.createObjectURL(new Blob([pdf],{type:'application/pdf'}));
        let link=document.createElement('a');
        link.href=url;
        link.download=`meter-${resource}-${activeRange.start}-to-${activeRange.end}.pdf`;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(()=>URL.revokeObjectURL(url),1000);
        $('report-status').textContent=`PDF report downloaded with ${activeRange.rows.length} readings.`;
    }catch(error){
        $('report-status').textContent='The PDF report could not be created.';
        console.error('PDF export failed:',error);
    }
});

$('energy-rate').addEventListener('input',renderEnergyInsights);
$('ask-form').addEventListener('submit',async event=>{
    event.preventDefault();
    $('answer').textContent='Analyzing…';
    $('ask').disabled=true;
    try{
        let question=$('q').value||'Why did my usage spike?';
        let result=await get(`/ask-ai?resource=${resource}&question=${encodeURIComponent(question)}`);
        $('answer').textContent=result.answer;
    }catch(error){
        $('answer').textContent=`Could not get an answer. ${error.message}`;
        console.error('Ask AI request failed:',error);
    }finally{
        $('ask').disabled=false;
    }
});

let threshold=readPreference('meter-alert-threshold','');
let severity=readPreference('meter-alert-severity','all');
if(threshold!=='') $('alert-threshold').value=threshold;
if(['all','high','medium'].includes(severity)) $('alert-severity').value=severity;
try{
    let savedRange=JSON.parse(readPreference('meter-range','null'));
    if(savedRange&&['7','14','30','90','all','custom'].includes(savedRange.period)){
        $('date-range').value=savedRange.period;
        $('date-from').value=savedRange.start||'';
        $('date-to').value=savedRange.end||'';
        updateDateControls();
    }
}catch(error){
    console.error('Could not restore date range:',error);
}
load();
