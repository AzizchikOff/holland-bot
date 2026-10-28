"use strict";

function canRunAdminCallback(q, adminId) {
  if (!q || !Number.isSafeInteger(adminId) || adminId <= 0) {
    return false;
  }

  return q.from?.id === adminId &&
         q.message?.chat?.id === adminId;
}

module.exports = { canRunAdminCallback };
