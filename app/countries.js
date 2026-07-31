(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ALCYONE_COUNTRIES = api;
}(this, function () {
  'use strict';

  /* This is the effective country set for every interface. It intentionally
     mirrors the bundled native SVG files and excludes the UN fallback itself. */
  var SUPPORTED = {ae:1,al:1,am:1,ar:1,at:1,au:1,az:1,ba:1,be:1,bg:1,br:1,by:1,ca:1,ch:1,cl:1,cn:1,cy:1,cz:1,de:1,dk:1,ee:1,es:1,fi:1,fr:1,gb:1,ge:1,gr:1,hk:1,hr:1,hu:1,id:1,ie:1,il:1,'in':1,is:1,it:1,jp:1,kg:1,kr:1,kz:1,lt:1,lu:1,lv:1,md:1,me:1,mk:1,mt:1,mx:1,my:1,nl:1,no:1,nz:1,ph:1,pl:1,pt:1,ro:1,rs:1,ru:1,se:1,sg:1,si:1,sk:1,th:1,tr:1,tw:1,ua:1,us:1,uz:1,vn:1};

  function normalize(code) {
    code = String(code || '').toLowerCase();
    return SUPPORTED[code] ? code : 'un';
  }

  function isSupported(code) {
    return normalize(code) !== 'un';
  }

  function regionalIndicator(letter) {
    var cp = 0x1F1E6 + letter.charCodeAt(0) - 97;
    cp -= 0x10000;
    return String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
  }

  function emoji(code) {
    code = normalize(code);
    return regionalIndicator(code.charAt(0)) + regionalIndicator(code.charAt(1));
  }

  function nativeSrc(code) {
    return 'flags/' + normalize(code) + '.svg';
  }

  function supportedCodes() {
    return Object.keys(SUPPORTED).sort();
  }

  return {
    normalize: normalize,
    isSupported: isSupported,
    emoji: emoji,
    nativeSrc: nativeSrc,
    supportedCodes: supportedCodes
  };
}));
