const fs = require('fs');
const express = require('express');
const bodyParser = require('body-parser');

const config = require('../cfg.json');
const {sendMail} = require('./mail');
const template = require('./mail-template');
const type = require('./type');

const triggerPort = config.net.port.trigger;
const temperatureOk = config.temperature.ok;
const temperatureWarning = config.temperature.warning;
const temperatureDanger = config.temperature.danger;
const sensorLostTimeout = config.sensor.lostTimeout;

const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));

const SensorState = {
  CONNECTED: 1,
  CONNECTION_LOST: 2,
};

const TemperatureState = {
  OK: 1,
  WARNING: 2,
  DANGER: 3,
};

let temperatureState = TemperatureState.OK;
let sensorState = SensorState.CONNECTED;

// This holds a timeout id. The timeout should be reseted every time the sensor sends some data. If
// the timeout is not reseted for a long time, the connection state should be marked as lost.
let sensorDataTimeout;

// This function is useful for resetting the `sensorDataTimeout` timeout. Call it every time the
// sensor sends any data.
const sensorSignal = () => {
  if (sensorState === SensorState.CONNECTION_LOST) {
    sendMail(template.connection.ok);
  }
  sensorState = SensorState.CONNECTED;
  clearTimeout(sensorDataTimeout);
  sensorDataTimeout = setTimeout(() => {
    sensorState = SensorState.CONNECTION_LOST;
    sendMail(template.connection.lost);
  }, sensorLostTimeout * 1000);
};

const saveSensorData = (temperature, humidity, electricalOutlet) => {
  const date = (new Date()).toString();
  const data = JSON.stringify({date, temperature, humidity, electricalOutlet}) + '\n';
  fs.writeFileSync('./sensor-data.json', data);
  fs.appendFileSync('./sensor-data.log', data);
};

const statusInform = (temperature, humidity, electricalOutlet) => {
  return `\nTemperature: ${temperature}ºC\nHumidity: ${humidity}%\nElectrical outlet: ${electricalOutlet}\n`;
};

app.post('/', (req, res) => {
  const {temperature, humidity, electricalOutlet} = req.body;
  console.log(req.body);
  if (!type.number(temperature)) {
    res.sendStatus(400);
    throw new TypeError('The "temperature" must be a number');
  }

  if (!type.boolean(electricalOutlet)) {
    res.sendStatus(400);
    throw new TypeError('The "electricalOutlet" must be a number');
  }

  if (!type.number(humidity)) {
    res.sendStatus(400);
    throw new TypeError('The "humidity" must be a number');
  }

  sensorSignal();

  saveSensorData(temperature, humidity, electricalOutlet);

  switch (temperatureState) {
    case TemperatureState.OK:
      if (temperature > temperatureDanger) {
        temperatureState = TemperatureState.DANGER;
        sendMail(template.temperature.danger + statusInform(temperature, humidity, electricalOutlet));
      } else if (temperature > temperatureWarning) {
        temperatureState = TemperatureState.WARNING;
        sendMail(template.temperature.warning + statusInform(temperature, humidity, electricalOutlet));
      }
      break;
    case TemperatureState.WARNING:
      if (temperature > temperatureDanger) {
        temperatureState = TemperatureState.DANGER;
        sendMail(template.temperature.danger + statusInform(temperature, humidity, electricalOutlet));
      } else if (temperature < temperatureOk) {
        temperatureState = TemperatureState.OK;
        sendMail(template.temperature.restored + statusInform(temperature, humidity, electricalOutlet));
      }
      break;
    case TemperatureState.DANGER:
      if (temperature < temperatureOk) {
        temperatureState = TemperatureState.OK;
        sendMail(template.temperature.restored + statusInform(temperature, humidity, electricalOutlet));
      }
      break;
    default:
      throw new Error('Unknown temperature state');
  }

  res.sendStatus(200);
});

app.listen(triggerPort, () => {
  console.log(`TriggerServer listening on port ${triggerPort}`);
});
