(function(){
  var path = window.location.pathname || '';
  var area = path.indexOf('/portal') === 0 ? 'portal' : (path.indexOf('/sistema') === 0 ? 'sistema' : null);
  if (!area) return;
  var cssHref = '/' + area + '/styles.css?v=3';
  if (![...document.styleSheets].some(function(s){ return s.href && s.href.indexOf(cssHref) !== -1; })) {
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = cssHref;
    document.head.appendChild(link);
  }
  var script = document.createElement('script');
  script.src = '/' + area + '/app.js?v=3';
  document.body.appendChild(script);
})();
