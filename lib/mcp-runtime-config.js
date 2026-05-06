'use strict';

function getLocalTimezone() {
  return process.env.LOCAL_TIMEZONE || 'America/Chicago';
}

module.exports = {
  getLocalTimezone
};
