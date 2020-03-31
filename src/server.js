/**************************************************************************
 *  (C) Copyright ModusBox Inc. 2019 - All rights reserved.               *
 *                                                                        *
 *  This file is made available under the terms of the license agreement  *
 *  specified in the corresponding source code repository.                *
 *                                                                        *
 *  ORIGINAL AUTHOR:                                                      *
 *       James Bush - james.bush@modusbox.com                             *
 **************************************************************************/

'use strict';

const util = require('util');
const express = require('express');
const request = require('request-promise-native');

const app = express();
const listenPort = process.env['LISTEN_PORT'] || 3000;
const outboundEndpoint = process.env['OUTBOUND_ENDPOINT'] || 'http://scheme-adapter:4001';

const { parties } = require('./data.json');
let homeTransactionId = 1000000;

const moment = require('moment');


/**
 * Look for JSON bodies on all incoming requests
 */
app.use(express.json({ type: '*/*'}));


/**
 * Log all requests
 */
app.use((req, res, next) => {
    console.log(`Request received: ${Date.now()} ${req.method} ${req.originalUrl}`);
    console.log(`Request headers: ${util.inspect(req.headers)}`);

    if(req.body) {
        console.log(`Request body: ${util.inspect(req.body, { depth: 10 })}`);
    }
    return next();
});


/**
 * Health check endpoint e.g. for Kubernetes
 */
app.get('/', (req, res) => {
    //return 200
    res.status(200).end();
});


/**
 * Handle get parties request. This method is called by the SDK to perform
 * party lookups in the backend. In this mock we have a static set of party
 * data loaded from a local JSON file.
 */
app.get('/parties/:idType/:idValue', async (req, res) => {
    console.log(`Party lookup received for ${req.params.idType} ${req.params.idValue}`);

    const party = parties[req.params.idType][req.params.idValue];
    if(party) {
        console.log(`Returning party: ${util.inspect(party)}`);

        return res.send(party);
    }

    console.log('Party not found');
    res.status(404).send({statusCode: '3204'});
});


/**
 * Handle post quote request. This method is called by the SDK to perform
 * a quote request. This gives our backend an opportunity to charge fees
 * for accepting a particular transfer.
 */
app.post('/quoterequests', async (req, res) => {

    console.log(`Quote request received: ${util.inspect(req.body)}`);

    let quote = {
        quoteId: req.body.quoteId,
        transactionId: req.body.transactionId,
        transferAmount: req.body.amount,
        payeeReceiveAmount: req.body.amount,
        transferAmountCurrency: req.body.currency,
        payeeReceiveAmountCurrency: req.body.currency,
        expiration: moment().add(1, 'Minute').toISOString()
    };

    // will use the MSISDN value to return different values
    let toMSISDN = req.body.to.idValue;

    switch (toMSISDN) {
        case '00000000':
          console.log('must return an error');
          // PAYEE_REJECTED_QUOTE
          res.status(500).send({
            statusCode: '5101'
          });
          break;
        case '11111111':
          console.log('expiration will be now');
          quote.expiration = moment().toISOString();
          res.send(quote);
          break;
        case '22222222':
          console.log('will take 70 seconds to respond, to simulate a timeout');
          await new Promise(r => setTimeout(r, 70000));
          console.log('sending response');
          res.send(quote);
          break;          
        default:
          console.log(`valid quote:: ${util.inspect(quote)}`);
          res.send(quote);
      }
});


/**
 * Handle post transfers request. This method is called by the SDK to inform the
 * backend of an incoming money transfer. This is called when a transfer has been
 * successfully received by the SDK.
 */
app.post('/transfers', async (req, res) => {
    // just increment homeTransactionId to simulate a backend creating a
    // transaction to put the incoming funds in the payee acount.
    console.log(`Incoming transfer received: ${util.inspect(req.body)}`);

    res.send({
        homeTransactionId: `${homeTransactionId++}`
    });
});


/**
 * Handle post send request. This method allows us to simulate outgoing transfers
 * from a DFSP backend.
 */
app.post('/send', async (req, res) => {
    console.log(`Request to send outgoing transfer: ${util.inspect(req.body)}`);

    const reqOpts = {
        method: 'POST',
        uri: `${outboundEndpoint}/transfers`,
        headers: buildHeaders(),
        body: req.body,
        json: true
    };

    try {
        console.log(`Executing HTTP POST: ${util.inspect(reqOpts)}`);
        const result = await request(reqOpts);
        res.send(result);
    }
    catch(err) {
        console.log(`Error: ${err.stack || util.inspect(err)}`);
        res.send({
            message: err.message || 'An error occured'
        });
        res.status(500).end();
    }
});


/**
 * Return 404 for non handled routes
 */
app.use((req, res) => {
    console.log(`Path not supported: ${req.originalUrl}`);
    res.status(404).end();
});


/**
 * Start the server
 */
const server = app.listen(listenPort, () => {
    console.log(`Listening on port ${listenPort}`);
});


/**
 * Utility method to build a set of headers required by the SDK outbound API
 *
 * @returns {object} - Object containing key/value pairs of HTTP headers
 */
const buildHeaders = () => {
    let headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Date': new Date().toUTCString()
    };

    return headers;
};


/**
 * Shutdown gracefully on SIGTERM
 */
process.on('SIGTERM', () => {
    server.close();
});
