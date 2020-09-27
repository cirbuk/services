export default {
  json: value => JSON.stringify(value),
  arrayToCSV: (value = []) => value.join(','),
  csvToArray: (value = '') => value.split(','),
  default: value => value
};