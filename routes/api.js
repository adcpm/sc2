const express = require('express');
const debug = require('debug')('sc2:server');
const { authenticate, verifyPermissions } = require('../helpers/middleware');
const { encode } = require('steem/lib/auth/memo');
const { issueUserToken } = require('../helpers/token');
const { getUserMetadata, updateUserMetadata } = require('../helpers/metadata');
const { getErrorMessage } = require('../helpers/operation');
const { isOperationAuthor } = require('../helpers/operation');
const config = require('../config.json');

const router = express.Router(); // eslint-disable-line new-cap

/** Update user_metadata */
router.put('/me', authenticate('app'), async (req, res) => {
  const scope = req.scope.length ? req.scope : config.authorized_operations;
  const accounts = await req.steem.api.getAccountsAsync([req.user]);
  const { user_metadata } = req.body;

  if (typeof user_metadata === 'object') { // eslint-disable-line camelcase
    /** Check object size */
    const bytes = Buffer.byteLength(JSON.stringify(user_metadata), 'utf8');
    if (bytes <= config.user_metadata.max_size) {
      /** Save user_metadata object on database */
      debug(`Store object for ${req.user} (size ${bytes} bytes)`);
      await updateUserMetadata(req.proxy, req.user, user_metadata);

      res.json({
        user: req.user,
        _id: req.user,
        name: req.user,
        account: accounts[0],
        scope,
        user_metadata,
      });
    } else {
      res.status(413).json({
        error: 'invalid_request',
        error_description: `User metadata object must not exceed ${config.user_metadata.max_size / 1000000} MB`,
      });
    }
  } else {
    res.status(400).json({
      error: 'invalid_request',
      error_description: 'User metadata must be an object',
    });
  }
});

/** Get my account details */
router.all('/me', authenticate(), async (req, res) => {
  const scope = req.scope.length ? req.scope : config.authorized_operations;
  const accounts = await req.steem.api.getAccountsAsync([req.user]);
  const userMetadata = req.role === 'app'
    ? await getUserMetadata(req.proxy, req.user)
    : undefined;
  res.json({
    user: req.user,
    _id: req.user,
    name: req.user,
    account: accounts[0],
    scope,
    user_metadata: userMetadata,
  });
});

/** Broadcast transaction */
router.post('/broadcast', authenticate('app'), verifyPermissions, async (req, res) => {
  const scope = req.scope.length ? req.scope : config.authorized_operations;
  const { operations } = req.body;

  let scopeIsValid = true;
  let requestIsValid = true;
  let invalidScopes = '';
  operations.forEach((operation) => {
    /** Check if operation is allowed */
    if (scope.indexOf(operation[0]) === -1) {
      scopeIsValid = false;
      invalidScopes += (invalidScopes !== '' ? ', ' : '') + operation[0];
    }
    /** Check if author of the operation is user */
    if (!isOperationAuthor(operation[0], operation[1], req.user)) {
      requestIsValid = false;
    }
  });

  if (!scopeIsValid) {
    res.status(401).json({
      error: 'invalid_scope',
      error_description: `The access_token scope does not allow the following operation(s): ${invalidScopes}`,
    });
  } else if (!requestIsValid) {
    res.status(401).json({
      error: 'unauthorized_client',
      error_description: `This access_token allow you to broadcast transaction only for the account @${req.user}`,
    });
  } else {
    debug(`Broadcast transaction for @${req.user} from app @${req.proxy}`);
    req.steem.broadcast.send(
      { operations, extensions: [] },
      { posting: process.env.BROADCASTER_POSTING_WIF },
      (err, result) => {
        /** Save in database the operations broadcasted */
        if (!err) {
          res.json({ result });
        } else {
          debug('Transaction broadcast failed', operations, err);
          res.status(500).json({
            error: 'server_error',
            error_description: getErrorMessage(err) || err.message || err,
          });
        }
      }
    );
  }
});

router.all('/login/challenge', async (req, res) => {
  const username = req.query.username;
  const role = req.query.role || 'posting';
  const token = issueUserToken(username);
  const accounts = await req.steem.api.getAccountsAsync([username]);
  const publicWif = role === 'memo' ? accounts[0].memo_key : accounts[0][role].key_auths[0][0];
  const code = encode(process.env.BROADCASTER_POSTING_WIF, publicWif, `#${token}`);
  res.json({
    username,
    code,
  });
});

router.all('/scope/save', authenticate(), async (req, res) => {
  if (!req.query.scope) {
    res.status(400).json({
      error: 'server_error',
      error_description: 'error_scope_required',
    });
  } else if (!req.query.client_id) {
    res.status(400).json({
      error: 'server_error',
      error_description: 'error_client_required',
    });
  } else {
    const { client_id, scope } = req.query;
    const scopes = scope.split(',');

    for (let i = 0; i < scopes.length; i += 1) {
      if (!config.authorized_operations.includes(scopes[i]) && !scopes[i] !== 'offline') {
        res.status(400).json({
          error: 'server_error',
          error_description: 'error_scope_invalid',
        });
        return;
      }
    }

    const authorization = {
      client_id,
      user: req.user,
      scope: scope.split(','),
    };

    const scopesDb = await req.db.authorizations.findOne({ where: { client_id, user: req.user } });
    if (!scopesDb) {
      req.db.authorizations.create(authorization).then(() => {
        res.json({ success: true });
      }).catch((error) => {
        res.status(400).json({ error });
      });
    } else {
      req.db.authorizations.update(authorization, { where: { client_id, user: req.user } })
        .then(() => {
          res.json({ success: true });
        }).catch((error) => {
          res.status(400).json({ error });
        });
    }
  }
});

module.exports = router;
