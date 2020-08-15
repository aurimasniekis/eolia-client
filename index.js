const axios = require('axios');

class EoliaClient {
    constructor(config = {}) {
        this.atkn = config.atkn ?? null;
        this.userId = config.userId;
        this.password = config.password;

        const options = {
            baseURL: config.host ?? 'https://app.rac.apws.panasonic.com',
            headers: {
                "User-Agent": config.userAgent ?? 'aurimasniekis/eoalia-client v1.0',
                "Accept": "application/json",
                "Content-Type": "application/Json; charset=UTF-8",
                "Accept-Language": "en-us",
            },
        };

        this.client = axios.create(options);
        this.client.interceptors.request.use(
            (requestConfig) => {
                if (this.atkn) {
                    requestConfig.headers.Cookie = this.atkn;
                }

                requestConfig.headers["X-Eolia-Date"] = new Date().toLocaleString('sv', {timeZoneName: 'short'}).split(" ").slice(0, 2).join("T");


                return requestConfig;
            }
        );

        this.client.interceptors.response.use(
            (response) => {
                if (response.headers["set-cookie"] && response.headers["set-cookie"].length > 0) {
                    this.atkn = response.headers["set-cookie"][0].split(';')[0];
                }

                return response;
            },
            (error) => {
                if (error.response.status === 401 || (error.response.status === 400 && !this.atkn)) {
                    return this.login(this.userId, this.password).then(() => {
                        return this.client.request(error.config);
                    })
                }

                return Promise.reject(error);
            }
        )
    }

    async authCheck() {
        const url = "/eolia/v2/auth/login";
        const body = {easy: {}};

        const response = await this.client.post(url, body);

        return response.data;
    }

    async login(id, pass, terminalType = 3, nextEasy = true) {
        const url = "/eolia/v2/auth/login";
        const body = {
            idpw: {
                id,
                pass,
                terminal_type: terminalType,
                next_easy: nextEasy,
            }
        };

        const response = await this.client.post(url, body);

        return response.data;
    }

    async logout() {
        const url = "/eolia/v2/auth/logout";

        return await this.client.post(url).then(res => res.data);

    }

    async productFunctions(productCode) {
        const url = `/eolia/v2/products/${productCode}/functions`;

        return this.client.get(url).then(res => res.data);
    }

    async devices() {
        const url = "/eolia/v2/devices";

        return this.client.get(url).then(res => res.data);
    }

    async deviceStatus(deviceId) {
        const url = `/eolia/v2/devices/${deviceId}/status`

        return this.client.get(url).then(res => res.data);
    }

    async deviceUpdate(deviceId, body) {
        const url = `/eolia/v2/devices/${deviceId}/status`

        return this.client.put(url, body).then(res => res.data);
    }
}

const OperationMode = {
    AUTO: 'Auto',
    COOLING: 'Cooling',
    HEATING: 'Heating',
    COOL_DEHUMIDIFYING: 'CoolDehumidifying',
    BLAST: 'Blast'
}

class EoliaAirConditioner {
    constructor(device, values, features) {
        this.device = device;
        this.values = values;
        this.features = features;
    }

    get applianceId() {
        return this.device['appliance_id'];
    }

    get nickname() {
        return this.device['nickname'];
    }

    get applianceType() {
        return this.device['appliance_type'];
    }

    get productCode() {
        return this.device['product_code'];
    }

    get productName() {
        return this.device['product_name'];
    }

    get pointCode() {
        return this.device['point_code'];
    }

    get operationStatus() {
        return this.values['operation_status'];
    }

    set operationStatus(value) {
        this.values['operation_status'] = value;
    }

    get operationMode() {
        return this.values['operation_mode'];
    }

    set operationMode(value) {
        switch (value) {
            case OperationMode.AUTO:
            case OperationMode.COOLING:
            case OperationMode.HEATING:
            case OperationMode.COOL_DEHUMIDIFYING:
                break;

            case OperationMode.BLAST:
                if (this.feature('blast') !== true) {
                    throw new Error(`Blast mode is not supported on "${this.productCode}"`);
                }
                break;

            default:
                throw new Error('Invalid Operation Mode');
        }

        return this.values['operation_mode'] = value;
    }

    get temperature() {
        return this.values['temperature'];
    }

    set temperature(value) {
        if (value < 16) {
            value = 16;
        } else if (value > 30) {
            value = 30;
        }

        this.values['temperature'] = value;
    }

    get windSpeed() {
        return this.values['wind_speed'];
    }

    set windSpeed(value) {
        if (value < 0) {
            value = 0;
        } else if (value > 5) {
            value = 5;
        }

        this.values['wind_speed'] = value;
    }

    get windDirection() {
        return this.values['wind_direction'];
    }

    set windDirection(value) {
        if (value < 0) {
            value = 0;
        } else if (value > 5) {
            value = 5;
        }

        this.values['wind_direction'] = value;
    }

    get insideHumidity() {
        return this.values['inside_humidity'] === 999 ? NaN : this.values['inside_humidity'];
    }

    get insideTemperature() {
        return this.values['inside_temp'];
    }

    get outsideTemperature() {
        return this.values['outside_temp'];
    }

    get operationPriority() {
        return this.values['operation_priority'];
    }

    get timerValue() {
        return this.values['timer_value'];
    }

    set timerValue(value) {
        this.values['timer_value'] = value;
    }

    get deviceErrorState() {
        return this.values['device_errstatus'];
    }

    get airQuality() {
        return this.values['airquality'];
    }

    get nanoex() {
        return this.values['nanoex'];
    }

    get aqValue() {
        return this.values['aq_value'];
    }

    get aqName() {
        return this.values['aq_name'];
    }

    feature(name) {
        return this.features[name] ?? false;
    }
}

class AdvancedEoliaClient {
    #config
    #client;
    #deviceList;

    constructor(userId, password, config = {}) {
        this.#config = {
            userId, password, ...config
        };

        this.#client = new EoliaClient(this.#config);
        this.#deviceList = null;
    }

    async begin() {
        await this.#client.authCheck();
    }

    async devices(fresh = false) {
        if (null !== this.#deviceList && false === fresh) {
            return this.#deviceList;
        }

        const rawDevices = await this.#client.devices();
        this.#deviceList = [];

        for (let i in rawDevices['ac_list']) {
            let rawDevice = rawDevices['ac_list'][i];
            let status = await this.#client.deviceStatus(rawDevice['appliance_id']);
            let rawFeatures = await this.#client.productFunctions(rawDevice['product_code']);
            let features = {};

            (rawFeatures['ac_function_list'] ?? []).map((feature) => {
                features[feature['function_id']] = feature['function_value'];
            })

            this.#deviceList.push(new EoliaAirConditioner(rawDevice, status, features));
        }

        return this.#deviceList;
    }

    async refresh(device) {
        if (!(device instanceof EoliaAirConditioner)) {
            throw new TypeError("Device argument must be EoliaAirConditioner");
        }

        device.values = await this.#client.deviceStatus(device.applianceId);

        return device;
    }

    async apply(device) {
        if (!(device instanceof EoliaAirConditioner)) {
            throw new TypeError("Device argument must be EoliaAirConditioner");
        }

        let values = {
            ...device.values,
            operation_token: Math.random().toString(36).substring(2),
        };

        values = await this.#client.deviceUpdate(device.applianceId, values);

        delete values.operation_token;

        device.values = values;

        return device;
    }
}

module.exports = {EoliaClient, AdvancedEoliaClient, EoliaAirConditioner, OperationMode };