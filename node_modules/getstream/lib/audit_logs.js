"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.StreamAuditLogs = void 0;
var _regenerator = _interopRequireDefault(require("@babel/runtime/regenerator"));
var _asyncToGenerator2 = _interopRequireDefault(require("@babel/runtime/helpers/asyncToGenerator"));
var _classCallCheck2 = _interopRequireDefault(require("@babel/runtime/helpers/classCallCheck"));
var _createClass2 = _interopRequireDefault(require("@babel/runtime/helpers/createClass"));
var _defineProperty2 = _interopRequireDefault(require("@babel/runtime/helpers/defineProperty"));
var StreamAuditLogs = exports.StreamAuditLogs = /*#__PURE__*/function () {
  function StreamAuditLogs(client, token) {
    (0, _classCallCheck2.default)(this, StreamAuditLogs);
    (0, _defineProperty2.default)(this, "token", void 0);
    (0, _defineProperty2.default)(this, "client", void 0);
    this.client = client;
    this.token = token;
  }
  (0, _createClass2.default)(StreamAuditLogs, [{
    key: "buildURL",
    value: function buildURL() {
      for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
        args[_key] = arguments[_key];
      }
      return "".concat(['audit_logs'].concat(args).join('/'), "/");
    }
  }, {
    key: "filter",
    value: function () {
      var _filter = (0, _asyncToGenerator2.default)( /*#__PURE__*/_regenerator.default.mark(function _callee(options) {
        return _regenerator.default.wrap(function _callee$(_context) {
          while (1) switch (_context.prev = _context.next) {
            case 0:
              return _context.abrupt("return", this.client.get({
                url: this.buildURL(),
                qs: options,
                token: this.token
              }));
            case 1:
            case "end":
              return _context.stop();
          }
        }, _callee, this);
      }));
      function filter(_x) {
        return _filter.apply(this, arguments);
      }
      return filter;
    }()
  }]);
  return StreamAuditLogs;
}();