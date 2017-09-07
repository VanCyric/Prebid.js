import Adapter from 'src/adapter';
import * as adaptermanager from '../src/adaptermanager';
import bidfactory from 'src/bidfactory';
import bidmanager from 'src/bidmanager';
import * as utils from 'src/utils';
import {STATUS} from 'src/constants';
import {ajax} from 'src/ajax';

function isNull(value) {
  return value === null || value === undefined;
}

const ENDPOINT = 'https://exchange.buzzoola.com/hb'; // TODO: real url
const BIDDER_CODE = 'buzzoola';
const MEDIA_TYPES = ['video', 'native'];

const emptyObj = {};

const PROTOCOLS = [
  'VAST 1.0',
  'VAST 2.0',
  'VAST 3.0',
  'VAST 1.0 Wrapper',
  'VAST 2.0 Wrapper',
  'VAST 3.0 Wrapper',
  'VAST 4.0',
  'VAST 4.0 Wrapper',
  'DAAST 1.0',
  'DAAST 1.0 Wrapper'
];

const IMP_OPTIONAL = [
  'metric',
  'pmp',
  'displaymanager',
  'displaymanagerver',
  'clickbrowser',
  'secure',
  'iframebuster',
  'exp',
  'ext'
];
const IMP_FORMAT_REQUIRED = {
  VIDEO: ['mimes', 'protocols'],
  NATIVE: []
};
const IMP_FORMAT_OPTIONAL = {
  VIDEO: [
    'minduration',
    'maxduration',
    'w',
    'h',
    'startdelay',
    'placement',
    'linearity',
    'skip',
    'skipmin',
    'skipafter',
    'sequence',
    'battr',
    'maxextended',
    'minbitrate',
    'maxbitrate',
    'boxingallowed',
    'playbackmethod',
    'playbackend',
    'delivery',
    'pos',
    'companionad',
    'api',
    'companiontype',
    'ext'
  ],
  NATIVE: [
    'ver',
    'api',
    'battr',
    'ext'
  ]
};

/**
 * Buzzoola bid adapter.
 *
 * @class BuzzoolaBidAdapter
 * @extends Adapter
 */
function BuzzoolaBidAdapter() {
  let buzzoolaAdapter = new Adapter(BIDDER_CODE);
  let bids = [];

  /**
   * Site info
   *
   * @property site
   * @type {Site}
   * @readonly
   */
  Object.defineProperty(this, "site", {
    get: () => {
      const location = utils.getTopWindowLocation();
      return {
        domain: document.domain || location.hostname,
        page: location.href,
        ref: document.referrer || location.href,
        search: location.search
      };
    },
    enumerable: true,
    configurable: true
  });

  /**
   * Device info
   *
   * @property device
   * @type {Device}
   * @readonly
   */
  Object.defineProperty(this, "device", {
    get: () => {
      const dnt = isNull(navigator.doNotTrack) ? emptyObj : {dnt: navigator.doNotTrack};
      const pxratio = isNull(window.devicePixelRatio) ? emptyObj : {pxratio: window.devicePixelRatio};

      return Object.assign({
        ua: navigator.userAgent,
        w: screen.width || window.innerWidth,
        h: screen.height || window.innerHeight,
        js: 1,
        language: navigator.language
      }, dnt, pxratio);
    },
    enumerable: true,
    configurable: true
  });

  /**
   * Rejects bid
   *
   * @param {String} id Bid id
   * @param {String} tagId Bid placement code (tag id)
   * @param {String} [reason='unknown'] Rejection reason
   * @private
   */
  function _rejectBid(id, tagId, reason = 'unknown') {
    let bidRequest = utils.getBidRequest(id);
    let bidObject = bidfactory.createBid(STATUS.NO_BID, bidRequest);

    // bidObject.bidderCode = BIDDER_CODE; TODO: uncomment if there is no bidder code in bid
    bidmanager.addBidResponse(tagId, bidObject);

    utils.logWarn(`${BIDDER_CODE}: could not handle bid ${id} (${reason})`);
  }

  /**
   * Search mediaType of bid
   *
   * @param {HBBid} bid HB bid
   * @param {String} bid.bidId Bid id
   * @param {String} bid.bidder Bidder's name
   * @param {String} bid.bidderRequestId Request id for bidder
   * @param {String} [bid.mediaType] Bid media type
   * @param {Object} [bid.nativeParams] Additional params for native ad
   * @param {Object} bid.params Additional params for bidder
   * @param {String} bid.placementCode Tag id
   * @param {Object} bid.renderer Ad renderer
   * @param {String} bid.requestId Request id
   * @param {Array<Array<Number>> | Array<Number>} bid.sizes Available sizes for ad
   * @param {String} bid.transactionId Transaction id
   * @return {String} Media type
   * @private
   */
  function _getMediaType(bid) {
    const mt = bid.mediaType;
    if (!isNull(mt) && MEDIA_TYPES.includes(mt)) {
      return mt;
    } else if (!isNull(bid.nativeParams)) {
      return 'native';
    } else if (utils.isEmpty(bid.params)) {
      return 'unsupported';
    } else if (!isNull(bid.params.video)) {
      return 'video';
    } else if (!isNull(bid.params.native)) {
      return 'native';
    } else {
      return 'unsupported';
    }
  }

  /**
   * Bid validation
   *
   * @param {HBBid} bid HB bid
   * @param {String} bid.bidId Bid id
   * @param {String} bid.bidder Bidder's name
   * @param {String} bid.bidderRequestId Request id for bidder
   * @param {String} [bid.mediaType] Bid media type
   * @param {Object} [bid.nativeParams] Additional params for native ad
   * @param {Object} bid.params Additional params for bidder
   * @param {String} bid.placementCode Tag id
   * @param {Object} bid.renderer Ad renderer
   * @param {String} bid.requestId Request id
   * @param {Array<Array<Number>> | Array<Number>} bid.sizes Available sizes for ad
   * @param {String} bid.transactionId Transaction id
   * @param {String} mediaType Bid media type
   * @return {boolean} Valid flag
   * @private
   */
  function _isValidBid(bid, mediaType) {
    let params = bid.params;
    let reason = '';

    if (utils.isEmpty(params)) {
      reason = 'empty bid params';
    } else if (isNull(params.bidFloor)) {
      reason = 'bidFloor is required';
    } else if (isNull(params.bidFloorCur)) {
      reason = 'bidFloorCur in bid params is required';
    } else if (mediaType === 'video' && isNull(params[mediaType])) {
      reason = `${mediaType} property in bid params is required for ${mediaType} ad`;
    } else {
      let media = params[mediaType] || emptyObj;
      for (let key of IMP_FORMAT_REQUIRED[mediaType.toUpperCase()]) {
        if (isNull(media[key])) {
          reason = `${key} property is required in ${mediaType} object for ${mediaType} ad`;
          break;
        }
      }
    }

    if (reason.length > 0) {
      _rejectBid(bid.bidId, bid.placementCode, reason);
      return false;
    }

    return true;
  }

  /**
   * Creates optional params
   *
   * @method _getOptional
   * @param {Object} target Params source
   * @param list Allowed params
   * @return {Object} Optional params
   * @private
   */
  function _getOptional(target, list) {
    let optional = {};
    for (let key of list) {
      let value = target[key];
      if (isNull(value)) continue;
      optional[key] = value;
    }
    return optional;
  }

  /**
   * Get ad size
   *
   * @method _getSize
   * @param {Array<Array<Number>> | Array<Number>} sizes Available sizes
   * @return {Object} Ad size
   * @private
   */
  function _getSize(sizes) {
    if (utils.isArray(sizes)) {
      if (utils.isArray(sizes[0])) {
        return {
          w: bid.sizes[0][0],
          h: bid.sizes[0][1]
        }
      } else {
        return {
          w: bid.sizes[0],
          h: bid.sizes[1]
        }
      }
    }

    return emptyObj;
  }

  /**
   * Converts protocol to number
   *
   * @method _convertProtocol
   * @param {String|Number} protocol
   * @return {Number} Protocol
   * @private
   */
  function _convertProtocol(protocol) {
    if (utils.isStr(protocol)) {
      if (PROTOCOLS.includes(protocol)) return PROTOCOLS.indexOf(protocol);

      let p;
      if (utils.isNumber(p = parseInt(protocol, 10))) return p;

      return null;
    } else if (utils.isNumber(protocol, 10)) {
      return protocol;
    } else {
      return null;
    }
  }

  /**
   * Creates video params for impression
   *
   * @method _getVideoParams
   * @param {HBBid} bid HB bid
   * @param {String} bid.bidId Bid id
   * @param {String} bid.bidder Bidder's name
   * @param {String} bid.bidderRequestId Request id for bidder
   * @param {String} [bid.mediaType] Bid media type
   * @param {Object} [bid.nativeParams] Additional params for native ad
   * @param {Object} bid.params Additional params for bidder
   * @param {String} bid.placementCode Tag id
   * @param {Object} bid.renderer Ad renderer
   * @param {String} bid.requestId Request id
   * @param {Array<Array<Number>> | Array<Number>} bid.sizes Available sizes for ad
   * @param {String} bid.transactionId Transaction id
   * @return {Object} Video params
   * @private
   */
  function _getVideoParams(bid) {
    let params = bid.params.video;
    let video = {
      protocols: (utils.isArray(params.protocols) ? params.protocols.map(_convertProtocol) : [_convertProtocol(params.protocols)]).filter(protocol => !isNull(protocol)),
      skip: isNull(params.skippable) ? 0 : +params.skippable,
      skipmin: 0,
      skipafter: 0,
      boxingallowed: 1
    };
    let optional = _getOptional(params, IMP_FORMAT_OPTIONAL.VIDEO);
    let size = _getSize(bid.sizes);

    return Object.assign(video, size, optional);
  }

  /**
   * Creates native assets
   *
   * @method _getNativeAssets
   * @param {HBBid} bid HB bid
   * @param {String} bid.bidId Bid id
   * @param {String} bid.bidder Bidder's name
   * @param {String} bid.bidderRequestId Request id for bidder
   * @param {String} [bid.mediaType] Bid media type
   * @param {Object} [bid.nativeParams] Additional params for native ad
   * @param {Object} bid.params Additional params for bidder
   * @param {String} bid.placementCode Tag id
   * @param {Object} bid.renderer Ad renderer
   * @param {String} bid.requestId Request id
   * @param {Array<Array<Number>> | Array<Number>} bid.sizes Available sizes for ad
   * @param {String} bid.transactionId Transaction id
   * @return {Array<Asset>} Native Assets
   * @private
   */
  function _getNativeAssets(bid){
    let size = _getSize(bid.sizes);
    let params = bid.nativeParams || emptyObj;
    let keys = Object.keys(params);
    if (keys.length === 1 && keys[0] === 'type'){
      // this is image type params
      params = {
        title: {
          required: true
        },
        sponsoredBy: {
          required: true
        },
        image: {
          required: true
        },
        clickUrl: {
          required: true
        },
        body: {
          required: false
        },
        icon: {
          required: false
        }
      }
    }

    return [{
      id: 0,
      required: 1,
      title: {
        len: (params.title || emptyObj).len || 140
      }
    }, {
      id: 1,
      required: 1,
      img: Object.assign({
        type: 3,
        w: screen.width,
        h: screen.width / 16 * 9
      }, size)
    }, {
      id: 2,
      required: 1,
      data: {
        type: 1
      }
    }, {
      id: 3,
      required: 1,
      data: {
        type: 11 // TODO: clickUrl
      }
    }, {
      id: 4,
      required: +((params.body || emptyObj).required || false),
      data: {
        type: 2 // TODO: body
      }
    }, {
      id: 5,
      required: +((params.icon || emptyObj).required || false),
      img: {
        type: 1
      }
    }];
  }

  /**
   * Creates native params for impression
   *
   * @method _getNativeParams
   * @param {HBBid} bid HB bid
   * @param {String} bid.bidId Bid id
   * @param {String} bid.bidder Bidder's name
   * @param {String} bid.bidderRequestId Request id for bidder
   * @param {String} [bid.mediaType] Bid media type
   * @param {Object} [bid.nativeParams] Additional params for native ad
   * @param {Object} bid.params Additional params for bidder
   * @param {String} bid.placementCode Tag id
   * @param {Object} bid.renderer Ad renderer
   * @param {String} bid.requestId Request id
   * @param {Array<Array<Number>> | Array<Number>} bid.sizes Available sizes for ad
   * @param {String} bid.transactionId Transaction id
   * @return {Object} Native params
   * @private
   */
  function _getNativeParams(bid) {
    let optional = Object.assign({
      ver: '1.2'
    }, _getOptional(bid.params.native, IMP_FORMAT_OPTIONAL.NATIVE));

    let assets = _getNativeAssets(bid);

    let request = Object.assign({
      plcmtcnt: bids.filter(bid => _getMediaType(bid) === 'native').indexOf(bid),
      seq: 0,
      assets: assets,
      urlsupport: 0,
      eventtrackers: [{
        event: 1,
        methods: [1]
      }],
      privacy: 0
    }, optional);

    let native = bid.params.native || {};
    if (!isNull(native.context)) request.context = native.context;
    if (!isNull(native.contextSubType)) request.contextsubtype = native.contextSubType;
    if (!isNull(native.placementType)) request.plcmttype = native.placementType;

    return Object.assign(optional, {
      request: JSON.stringify(request)
    });
  }

  /**
   * Creates format based params of impression
   *
   * @method _getFormatParams
   * @param {HBBid} bid HB bid
   * @param {String} bid.bidId Bid id
   * @param {String} bid.bidder Bidder's name
   * @param {String} bid.bidderRequestId Request id for bidder
   * @param {String} [bid.mediaType] Bid media type
   * @param {Object} [bid.nativeParams] Additional params for native ad
   * @param {Object} bid.params Additional params for bidder
   * @param {String} bid.placementCode Tag id
   * @param {Object} bid.renderer Ad renderer
   * @param {String} bid.requestId Request id
   * @param {Array<Array<Number>> | Array<Number>} bid.sizes Available sizes for ad
   * @param {String} bid.transactionId Transaction id
   * @param {String} mediaType Bid media type
   * @return {Object} Format based params
   * @private
   */
  function _getFormatParams(bid, mediaType) {
    switch (mediaType) {
      case 'native':
        return {native: _getNativeParams(bid)};
        break;
      case 'video':
        return {video: _getVideoParams(bid)};
        break;
      default:
        utils.logWarn(`${BIDDER_CODE}: could not get format based params for bid ${bid.bidId}`);
        return emptyObj;
    }
  }

  /**
   * Creates impression from HB bid
   *
   * @method _createImpression
   * @param {HBBid} bid HB bid
   * @param {String} bid.bidId Bid id
   * @param {String} bid.bidder Bidder's name
   * @param {String} bid.bidderRequestId Request id for bidder
   * @param {String} [bid.mediaType] Bid media type
   * @param {Object} [bid.nativeParams] Additional params for native ad
   * @param {Object} bid.params Additional params for bidder
   * @param {String} bid.placementCode Tag id
   * @param {Object} bid.renderer Ad renderer
   * @param {String} bid.requestId Request id
   * @param {Array<Array<Number>> | Array<Number>} bid.sizes Available sizes for ad
   * @param {String} bid.transactionId Transaction id
   * @param {String} mediaType Bid media type
   * @return {Impression} OpenRTB Imp
   * @private
   */
  function _createImpression(bid, mediaType) {
    let params = bid.params;
    let imp = {
      id: bid.bidId,
      tagid: bid.placementCode,
      bidfloor: params.bidFloor,
      bidfloorcur: params.bidFloorCur,
      instl: params.instl || 0
    };
    let format = _getFormatParams(bid, mediaType);
    let optional = _getOptional(params, IMP_OPTIONAL);

    return Object.assign(imp, format, optional);
  }

  /**
   * Creates impressions from HB bids
   *
   * @method _createImpressions
   * @param {Array<HBBid>} bids Available bids
   * @return {Array<Impression>} Array of impressions
   * @private
   */
  function _createImpressions(bids) {
    let imps = [];

    for (let bid of bids) {
      let mediaType = _getMediaType(bid);

      if (mediaType === 'unsupported') {
        _rejectBid(bid.bidId, bid.placementCode, 'unsupported or unknown media type');
        continue;
      }

      if (!_isValidBid(bid, mediaType)) continue;

      imps.push(_createImpression(bid, mediaType));
    }

    return imps;
  }

  /**
   * Converts HB request data to OpenRTB bid request
   *
   * @method _hbToRtb
   * @param {HBBidRequest} hbBidRequest
   * @param {Number} hbBidRequest.auctionStart Timestamp for start of auction
   * @param {String} hbBidRequest.bidderCode Bidder's name ('buzzoola' in our case)
   * @param {String} hbBidRequest.bidderRequestId Request id for bidder
   * @param {Array<HBBid>} hbBidRequest.bids Available bids
   * @param {String} hbBidRequest.requestId Request id
   * @param {Number} hbBidRequest.start Timestamp
   * @param {Number} hbBidRequest.timeout Request timeout in ms
   * @return {BidRequest} OpenRTB BidRequest
   * @private
   */
  function _hbToRtb(hbBidRequest) {
    const imp = _createImpressions(hbBidRequest.bids || []);

    return Object.assign({
      id: hbBidRequest.bidderRequestId,
      at: 1,
      tmax: hbBidRequest.timeout || 0,
      test: 0,
      allimps: 0
    }, {imp: imp}, {site: this.site}, {device: this.device});
  }

  /**
   * Parses bid
   *
   * @method _parseBid
   * @param {Bid} bid OpenRTB Bid
   * @private
   */
  function _parseBid(bid){
    let bidRequest = utils.getBidRequest(bid.impid);
    let bidObject = bidfactory.createBid(STATUS.GOOD, bidRequest);

    // bidObject.bidderCode = BIDDER_CODE; TODO: uncomment if there is no bidder code in bid
    bidObject.cpm = bid.price;
    bidObject.adId = bid.adid;
    bidObject.width = bid.w;
    bidObject.height = bid.h;
    bidObject.deadlId = bid.dealid;

    // TODO: check media type here
    switch (bidObject.mediaType){
      case 'video':
        bidObject.vastUrl = bid.nurl;
        break;
      case 'native':
        let native = JSON.parse(bid.adm);
        let assets = [];
        let params = {};

        (native.assets || []).forEach(asset => {
          assets[asset.id] = asset;
        });

        if (assets[0] && assets[0].title && assets[0].title.text) params.title = assets[0].title.text;
        if (assets[1] && assets[1].img && assets[1].img.url) params.image = assets[1].img.url;
        if (assets[2] && assets[2].data && assets[2].data.value) params.image = assets[2].data.value;
        if (assets[3] && assets[3].data && assets[3].data.value) params.image = assets[3].data.value;
        if (assets[4] && assets[4].data && assets[4].data.value) params.image = assets[4].data.value;
        if (assets[5] && assets[5].img && assets[5].img.url) params.image = assets[5].img.url;

        params.impressionTrackers = (native.eventtrackers || [])
          .filter(track => track.event === 1 && track.mathod === 1)
          .map(track => track.url);

        bidObject.native = params;
        break;
      default:
        utils.logWarn(`${BIDDER_CODE}: could not add format specific params to bid with unsupported media type`);
    }

    bidmanager.addBidResponse(tagId, bidObject);

    utils.logMessage(`${BIDDER_CODE}: could not handle bid ${id} (${reason})`);
  }

  /**
   * Converts OpenRTB BidResponse to HB response data
   *
   * @method _rtbToHb
   * @param {BidResponse} bidResponse OpenRTB BidResponse
   * @param {BidRequest} bidRequest OpenRTB BidRequest
   * @private
   */
  function _rtbToHb(bidResponse, bidRequest){
    let bids = {};
    for (let seat of bidResponse.seatbid){
      for (let bid of seat){
        bids[bid.impid] = bid;
      }
    }
    for (let imp of bidRequest.imp){
      if (bids.hasOwnProperty(imp.id)){
        _parseBid(bids[imp.id]);
      } else {
        _rejectBid(imp.id, imp.tagid, 'is missing in BidResponse')
      }
    }
  }

  /**
   * Sends request to buzzoola server
   *
   * @method _sendBidRequest
   * @param {BidRequest} bidRequest OpenRTB BidRequest
   * @async
   * @private
   */
  function _sendBidRequest(bidRequest){
    const success = (response, request) => {
      let data;

      try {
        data = JSON.parse(response);
      } catch (e) {
        data = response;
      }

      _rtbToHb(data, bidRequest);
    };
    const error = (type) => {
      utils.logError(`${BIDDER_CODE}: xhr error`, null, type);
      for (let imp of bidRequest.imp){
        _rejectBid(imp.id, imp.tagid, `xhr error: ${type}`);
      }
    };

    ajax(ENDPOINT, {success, error}, bidRequest, {
      method: 'POST',
      contentType: 'application/json',
      withCredentials: true,
      preflight: true
    });
  }

  /**
   * Bids handler
   *
   * @method callBids
   * @param {HBBidRequest} hbBidRequest
   * @param {Number} hbBidRequest.auctionStart Timestamp for start of auction
   * @param {String} hbBidRequest.bidderCode Bidder's name ('buzzoola' in our case)
   * @param {String} hbBidRequest.bidderRequestId Request id for bidder
   * @param {Array<HBBid>} hbBidRequest.bids Available bids
   * @param {String} hbBidRequest.requestId Request id
   * @param {Number} hbBidRequest.start Timestamp
   * @param {Number} hbBidRequest.timeout Request timeout in ms
   */
  buzzoolaAdapter.callBids = (hbBidRequest) => {
    bids = hbBidRequest.bids || [];

    let bidRequest = _hbToRtb(hbBidRequest);

    if (bidRequest.imp.length === 0) {
      utils.logWarn(`${BIDDER_CODE}: could not handle bid request ${hbBidRequest.requestId} (no valid bids)`);
      return;
    }

    _sendBidRequest(bidRequest);
  };

  return Object.assign(this, buzzoolaAdapter);
}

adaptermanager.registerBidAdapter(new BuzzoolaBidAdapter(), BIDDER_CODE, {
  supportedMediaTypes: MEDIA_TYPES
});

module.exports = BuzzoolaBidAdapter;
