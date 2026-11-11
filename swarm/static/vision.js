import {createLiveAdapter} from './vision-adapter.mjs';
const read=createLiveAdapter();
const $=id=>document.getElementById(id);
async function refresh(){
  const data=await read();
  $('status').textContent=data.message;
  $('status').className=data.available?'':'error';
  $('timestamp').textContent=`Last attempt: ${new Date(data.checked_at).toLocaleString()}${data.fetched_at?' · Last verified: '+new Date(data.fetched_at).toLocaleString():''}`;
  $('missions').replaceChildren();
  for(const mission of data.tasks){
    const row=document.createElement('tr');row.title=mission.reason;
    for(const value of [mission.objective,mission.role,mission.status,new Date(mission.updated).toLocaleString()]){
      const cell=document.createElement('td');cell.textContent=value;row.append(cell);
    }
    $('missions').append(row);
  }
}
$('refresh').onclick=refresh;setInterval(refresh,30000);refresh();
