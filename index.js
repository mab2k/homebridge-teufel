 'use strict';

var RaumkernelLib = require('node-raumkernel');

var Accessory, Service, Characteristic, UUIDGen;
var virtualZoneName = "Virtual Zone";

module.exports = function (homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    Accessory = homebridge.platformAccessory;
    UUIDGen = homebridge.hap.uuid;

    homebridge.registerPlatform("homebridge-teufel", "Teufel", TeufelPlatform, true);
}

function TeufelPlatform(log, config, api) {
    this.name = "Raumfeld Zone";
    this.config = config;
    this.accessories = [];
    this.api = api;
    this.log = log;
    this.raumkernel = new RaumkernelLib.Raumkernel();

    // Initializing Raumfeldkernel
    this.raumkernel.createLogger();
    this.raumkernel.init();

    var self = this;

    this.api.on('didFinishLaunching', function () {
        self.raumkernel.on("zoneConfigurationChanged", function (zoneConfiguration) {
            if (zoneConfiguration !== null) {
                self.addAccessory(zoneConfiguration);
                self.addVirtualZone(zoneConfiguration);
            }
        });
        self.raumkernel.on("mediaRendererRaumfeldRemoved", function (_deviceUdn, _name) {
	    	self.removeAccessory(_deviceUdn, _name);
        });

    }.bind(this));
}

TeufelPlatform.prototype.addAccessory = function (zoneConfiguration) {
    var rooms = zoneConfiguration.zoneConfig.zones[0].zone[0].room;

    // Check for new Speakers in rooms
    for (var i in rooms) {
        var newAccessoryDisplayName = rooms[i].renderer[0].$.name;
        var alreadyAdded = false;

        // Check if Accessory already added
        for (var j in this.accessories) {
            if (this.accessories[j].displayName.trim() === newAccessoryDisplayName.trim()) {
                this.accessories[j].context.deviceName = rooms[i].renderer[0].$.name.trim();
                this.accessories[j].context.deviceUdn = rooms[i].renderer[0].$.udn;
                this.accessories[j].context.roomName = rooms[i].$.name.trim();
                this.accessories[j].context.roomUdn = rooms[i].$.udn;
                this.accessories[j].context.zoneUdn = zoneConfiguration.zoneConfig.zones[0].zone[0].$.udn;
                alreadyAdded = true;
                break;
            }
        }

        if (!alreadyAdded) {
            this.log("Found Teufel device " + newAccessoryDisplayName + ", processing.");

            var uuid = UUIDGen.generate(rooms[i].renderer[0].$.name.trim());
            var newAccessory = new Accessory(newAccessoryDisplayName, uuid);
            var informationService = newAccessory.getService(Service.AccessoryInformation);

            informationService
                .setCharacteristic(Characteristic.Manufacturer, "Raumfeld / Teufel")
                .setCharacteristic(Characteristic.Model, "Raumfeld");

            this.addSwitchService(newAccessory);
            this.accessories.push(newAccessory);
            this.api.registerPlatformAccessories("homebridge-teufel", "Teufel", [newAccessory]);
        }
    }
}


TeufelPlatform.prototype.addVirtualZone = function (zoneConfiguration) {
    var virtualZoneUdn = zoneConfiguration.zoneConfig.zones[0].zone[0].$.udn;
    var alreadyAdded = false;

    // Check if Accessory already added
    for (var j in this.accessories) {
        if (this.accessories[j].displayName === virtualZoneName) {
            this.log("Device removed or added, updating virtual zone UDN to " + virtualZoneUdn + " for all devices");
            this.accessories[j].context.deviceUdn = virtualZoneUdn;

            for (var k in this.accessories) {
                this.accessories[k].context.zoneUdn = virtualZoneUdn;
            }
            alreadyAdded = true;
        }
    }

    if (!alreadyAdded) {
        this.log("Creating virtual Zone, processing.");

        var uuid = UUIDGen.generate(virtualZoneName);
        var newAccessory = new Accessory(virtualZoneName, uuid);
        var informationService = newAccessory.getService(Service.AccessoryInformation);

        newAccessory.context.deviceName = virtualZoneName;
        newAccessory.context.deviceUdn = virtualZoneUdn;
        newAccessory.context.roomName = "Raumfeld";
        newAccessory.context.roomUdn = "Raumfleld";

        informationService
            .setCharacteristic(Characteristic.Manufacturer, "Raumfeld / Teufel")
            .setCharacteristic(Characteristic.Model, virtualZoneName);

        this.addSwitchService(newAccessory);
        this.accessories.push(newAccessory);
        this.api.registerPlatformAccessories("homebridge-teufel", "Teufel", [newAccessory]);
    }
}

TeufelPlatform.prototype.removeAccessory = function (_deviceUdn, _name) {
    for (var l in this.accessories) {
		if (this.accessories[l].context.deviceName === _name) {
            try {
                this.log("Going to delete device with name " + this.accessories[l].context.deviceName);
                this.api.unregisterPlatformAccessories("homebridge-teufel", "Teufel", [this.accessories[l]]);
                delete this.accessories[l];
            } catch (err) {
                this.log("Something went wrong deleting device " + this.accessories[l].context.deviceName);
            }
        }
    }
}

TeufelPlatform.prototype.configureAccessory = function (accessory) {
    this.log(accessory.displayName, "Configure Accessory");
    this.addSwitchService(accessory);
    this.accessories.push(accessory);
}

TeufelPlatform.prototype.addSwitchService = function (accessory) {
    var self = this;
    accessory.on('identify', function (paired, callback) {
        callback();
    });

    accessory.reachable = true;

    if (accessory.getService(Service.Switch)) {
        accessory.getService(Service.Switch)
            .getCharacteristic(Characteristic.On)
            .on('get', function (callback) {
                if (callback) callback(null, self.getSwitchState(accessory));
            })
            .on('set', function (value, callback) {
                if (callback) callback(null, self.changeRaumfeldState(accessory, value));
            });
    } else {
        accessory.addService(Service.Switch)
            .getCharacteristic(Characteristic.On)
            .on('get', function (callback) {
                if (callback) callback(null, self.getSwitchState(accessory));
            })
            .on('set', function (value, callback) {
                if (callback) callback(null, self.changeRaumfeldState(accessory, value));
            });
    }
}

TeufelPlatform.prototype.getSwitchState = function (accessory) {
    var self = this;

    var zoneId = accessory.context.deviceUdn;
    var name = accessory.displayName;

    if (name === virtualZoneName) {
        var virtualZoneConfigProvider = self.raumkernel.managerDisposer.deviceManager.getVirtualMediaRenderer(zoneId);

        if (virtualZoneConfigProvider != null) {
            virtualZoneConfigProvider.getTransportInfo().then(function (_data) {
                if (_data.CurrentTransportState !== 'PLAYING') {
                    setTimeout(function() {
                          accessory.getService(Service.Switch).getCharacteristic(Characteristic.On).setValue(0);
                    }.bind(this), 1000);
                } else {
                   setTimeout(function() {
                          accessory.getService(Service.Switch).getCharacteristic(Characteristic.On).setValue(1);
                    }.bind(this), 1000);
                }
            });
        }
    } else {
        var zoneConfigProvider = self.raumkernel.managerDisposer.zoneManager.zoneConfiguration;
        var zoneJson = zoneConfigProvider.zoneConfig.zones[0].zone[0];

        for (var i in zoneJson.room) {
            if (zoneJson.room[i].renderer[0].$.udn === zoneId) {
                var powerstate = zoneJson.room[i].$.powerState;
                if (powerstate !== 'ACTIVE') {
                    return false;
                } else {
                    return true;
                }
            }
        }
    }
}

TeufelPlatform.prototype.changeRaumfeldState = function (accessory, state) {
    var self = this;
    var mediaRenderer = self.raumkernel.managerDisposer.deviceManager.getVirtualMediaRenderer(accessory.context.deviceUdn);

    if (mediaRenderer !== null) {
        try {
            if (state) {
                if (accessory.displayName === virtualZoneName) {
                     setTimeout(function() {
                        mediaRenderer.play().then(function (_data) {
                        });
                    }.bind(this), 3000);
                } else {
                    mediaRenderer.leaveStandby(accessory.context.roomUdn).then(function (_data) {
                        mediaRenderer.play().then(function (_data) {
                            self.raumkernel.managerDisposer.zoneManager.connectRoomToZone(accessory.context.roomUdn, accessory.context.zoneUdn).then(function (_data) {
                            });
                        });
                    });
                }
            } else {
                if (accessory.displayName === virtualZoneName) {
                    mediaRenderer.stop().then(function (_data) {
                    });
                } else {
                    mediaRenderer.enterManualStandby(accessory.context.roomUdn).then(function (_data) {
                    });
                }
            }
        } catch (err) {
            this.log("Something went wrong while communicating with Raumfeld / Teufel devices, maybe not reachable? Waiting for automatic UDN update...")
        }
    }
}
