(function(){
  try{
    var visitorKey='moa_visitor_id';
    function getCookie(n){var m=document.cookie.match(new RegExp('(^|; )'+n+'=([^;]+)'));return m?decodeURIComponent(m[2]):null;}
    function setCookie(n,v,d){var dt=new Date();dt.setTime(dt.getTime()+(d*864e5));document.cookie=n+'='+encodeURIComponent(v)+'; path=/; max-age='+(d*86400)+'; SameSite=Lax';}
    var visitorId=localStorage.getItem(visitorKey)||getCookie(visitorKey);
    if(!visitorId){visitorId=(crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random().toString(36).slice(2)).replace(/-/g,'');}
    try{localStorage.setItem(visitorKey,visitorId);}catch(e){}
    setCookie(visitorKey,visitorId,365);
    var sessionKey='moa_session_id';
    var sessionId=sessionStorage.getItem(sessionKey);
    if(!sessionId){sessionId=(crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random().toString(36).slice(2)).replace(/-/g,'');try{sessionStorage.setItem(sessionKey,sessionId);}catch(e){}}

    function trackEvent(eventName, meta){
      try{
        if(!eventName||typeof eventName!=='string')return;
        var source=(meta&&typeof meta.source==='string')?meta.source:'';
        var body=JSON.stringify({
          event:eventName,
          source:source,
          referrer:document.referrer||'',
          screenWidth:screen.width,
          visitorId:visitorId,
          sessionId:sessionId
        });
        fetch('/api/analytics/event',{method:'POST',headers:{'Content-Type':'application/json'},body:body,keepalive:true}).catch(function(){});
      }catch(e){}
    }

    window.MoaAnalytics={
      track:trackEvent,
      visitorId:visitorId,
      sessionId:sessionId
    };

    // Configure analytics endpoint via window.__ANALYTICS_ENDPOINT__ (e.g. 'https://analytics.example.com/api/analytics/collect')
    var endpoint = window.__ANALYTICS_ENDPOINT__ || '';
    if(!endpoint) return; // Disabled by default in self-hosted / open-source deployments
    if(endpoint.indexOf('analytics/collect') === -1) {
      endpoint = endpoint.replace(/\/$/, '') + '/api/analytics/collect';
    }
    var payload=JSON.stringify({siteId:'moa-calendar',path:location.pathname,referrer:document.referrer,screenWidth:screen.width,visitorId:visitorId,sessionId:sessionId});
    if(navigator.sendBeacon){navigator.sendBeacon(endpoint,new Blob([payload],{type:'application/json'}));}
    else{fetch(endpoint,{method:'POST',body:payload,headers:{'Content-Type':'application/json'},keepalive:true}).catch(function(){});}
  }catch(e){}
})();
