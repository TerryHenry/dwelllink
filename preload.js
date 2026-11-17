'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  auth: {
    needsSetup: invoke('auth:needsSetup'),
    setup: invoke('auth:setup'),
    login: invoke('auth:login'),
    logout: invoke('auth:logout'),
    me: invoke('auth:me'),
    changePassword: invoke('auth:changePassword')
  },
  users: {
    list: invoke('users:list'),
    create: invoke('users:create'),
    delete: invoke('users:delete'),
    resetPassword: invoke('users:resetPassword'),
    setVenues: invoke('users:setVenues')
  },
  audit: {
    list: invoke('audit:list')
  },
  updates: {
    getVersion: invoke('app:getVersion'),
    check: invoke('app:checkForUpdates'),
    openUpdatePage: invoke('app:openUpdatePage'),
    checkWhatsNew: invoke('app:checkWhatsNew')
  },
  settings: {
    get: invoke('settings:get'),
    setIdleTimeout: invoke('settings:setIdleTimeout'),
    setRuckusConfig: invoke('settings:setRuckusConfig'),
    getBranding: invoke('settings:getBranding'),
    setBranding: invoke('settings:setBranding'),
    resetBranding: invoke('settings:resetBranding'),
    exportConfig: invoke('settings:exportConfig'),
    importConfig: invoke('settings:importConfig')
  },
  venues: {
    add: invoke('venues:add'),
    update: invoke('venues:update'),
    remove: invoke('venues:remove'),
    setActive: invoke('venues:setActive')
  },
  discovery: {
    venues: invoke('discovery:venues'),
    dpskPools: invoke('discovery:dpskPools'),
    wifiNetworks: invoke('discovery:wifiNetworks'),
    recommendedDpskPool: invoke('discovery:recommendedDpskPool')
  },
  units: {
    list: invoke('units:list'),
    get: invoke('units:get'),
    create: invoke('units:create'),
    update: invoke('units:update'),
    delete: invoke('units:delete'),
    setStatus: invoke('units:setStatus'),
    moveOut: invoke('units:moveOut'),
    resendNotifications: invoke('units:resendNotifications'),
    associateIdentity: invoke('units:associateIdentity'),
    removeIdentity: invoke('units:removeIdentity'),
    residents: invoke('units:residents'),
    builtinIdentities: invoke('units:builtinIdentities'),
    clients: invoke('units:clients'),
    openResidentPortal: invoke('units:openResidentPortal'),
    disconnectClient: invoke('units:disconnectClient')
  },
  directory: {
    listAllVenues: invoke('directory:listAllVenues')
  },
  print: {
    wifiSheetPdf: invoke('print:wifiSheetPdf')
  },
  identities: {
    listAll: invoke('identities:listAll'),
    create: invoke('identities:create'),
    update: invoke('identities:update'),
    regenerate: invoke('identities:regenerate'),
    setRevoked: invoke('identities:setRevoked'),
    delete: invoke('identities:delete'),
    clientDetail: invoke('identities:clientDetail')
  }
});
