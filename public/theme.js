// Theme bootstrap: runs synchronously in <head> before first paint (CSP-safe, no inline script).
// Supported themes: 'light' (default) and 'dark'.
(function(){
 var theme='light';
 try{if(localStorage.getItem('color-scheme')==='dark')theme='dark';}catch(e){}
 var root=document.documentElement;
 root.setAttribute('data-theme',theme);
 root.style.colorScheme=theme;
 var themeMeta=document.querySelector('meta[name="theme-color"]');
 if(themeMeta)themeMeta.setAttribute('content',theme==='dark'?'#1a2420':'#38664e');
})();
