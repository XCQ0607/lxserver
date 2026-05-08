Ext.namespace("SYNO.SDS.LXServer.Utils");

Ext.apply(SYNO.SDS.LXServer.Utils, {
  getMainHtml: function () {
    var ts = new Date().getTime();
    return '<iframe src="/webman/3rdparty/lxserver/index.html?_ts=' + ts + '" title="LX Music Sync Server" style="width:100%;height:100%;border:none;margin:0;"></iframe>';
  }
});

Ext.define("SYNO.SDS.LXServer.Application", {
  extend: "SYNO.SDS.AppInstance",
  appWindowName: "SYNO.SDS.LXServer.MainWindow",
  constructor: function () {
    this.callParent(arguments);
  }
});

Ext.define("SYNO.SDS.LXServer.MainWindow", {
  extend: "SYNO.SDS.AppWindow",
  constructor: function (a) {
    this.appInstance = a.appInstance;
    SYNO.SDS.LXServer.MainWindow.superclass.constructor.call(this, Ext.apply({
      layout: "fit",
      resizable: true,
      maximizable: true,
      minimizable: true,
      width: 620,
      height: 430,
      html: SYNO.SDS.LXServer.Utils.getMainHtml()
    }, a));
  },
  onOpen: function () {
    SYNO.SDS.LXServer.MainWindow.superclass.onOpen.apply(this, arguments);

    var self = this;
    this._lxserverCloseHandler = function (event) {
      if (!event || !event.data || event.data.type !== "LXSERVER_CLOSE") return;
      self._lxserverClosing = true;
      // 触发 onClose，由框架统一关闭窗口
      self.doClose();
    };
    window.addEventListener("message", this._lxserverCloseHandler);
  },
  onClose: function () {
    SYNO.SDS.LXServer.MainWindow.superclass.onClose.apply(this, arguments);

    try {
      if (this._lxserverCloseHandler) {
        window.removeEventListener("message", this._lxserverCloseHandler);
      }
    } catch {}

    if (!this._lxserverClosing) {
      this.doClose();
    }
    this._lxserverClosing = false;
    return true;
  }
});
