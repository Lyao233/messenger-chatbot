'use strict';
const request = require('request');
const crypto = require('crypto');
const config = require('../config');
module.exports = {
    sendPassThread: function(senderID) {
        request(
            {
                uri: "https://graph.facebook.com/v2.6/me/pass_thread_control",
                qs: { access_token: config.FB_PAGE_TOKEN },
                method: "POST",
                json: {
                    recipient: {
                        id: senderID
                    },
                    target_app_id: config.FB_PAGE_INBOX_ID // ID in the page inbox setting under messenger platform
                }
            }
        );
    },

    handleMessages: function(messages, sender){
        let self = module.exports;
        let timeoutInterval = 1100;
        let previousType ;
        let cardTypes = [];
        let timeout = 0;
        for (var i = 0; i < messages.length; i++) {

            if ( previousType == "card" && (messages[i].message != "card" || i == messages.length - 1)) {
                timeout = (i - 1) * timeoutInterval;
                setTimeout(self.handleCardMessages.bind(null, cardTypes, sender), timeout);
                cardTypes = [];
                timeout = i * timeoutInterval;
                setTimeout(self.handleMessage.bind(null, messages[i], sender), timeout);
            } else if ( messages[i].message == "card" && i == messages.length - 1) {
                cardTypes.push(messages[i]);
                timeout = (i - 1) * timeoutInterval;
                setTimeout(self.handleCardMessages.bind(null, cardTypes, sender), timeout);
                cardTypes = [];
            } else if ( messages[i].message == "card") {
                cardTypes.push(messages[i]);
            } else  {

                timeout = i * timeoutInterval;
                setTimeout(self.handleMessage.bind(null, messages[i], sender), timeout);
            }

            previousType = messages[i].message;

        }
    },
    handleMessageAttachments: function(messageAttachments, senderID){
        let self = module.exports;
        //for now just reply messageAttachments[0].payload.url
        self.sendTextMessage(senderID, "Attachment received. Thank you.");
    },

    //https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-echo
    handleEcho: function(messageId, appId, metadata) {
        // Just logging message echoes to console
        console.log("Received echo for message %s and app %d with metadata %s", messageId, appId, metadata);
    },

    handleMessage: function(message, sender) {
        let self = module.exports;
        switch (message.message) {
            case "text": //text
                message.text.text.forEach((text) => {
                    if (text !== '') {
                        self.sendTextMessage(sender, text);
                    }
                });
                break;
            case "quickReplies": //quick replies
                let replies = [];
                message.quickReplies.quickReplies.forEach((text) => {
                    let reply =
                        {
                            "content_type": "text",
                            "title": text,
                            "payload": text
                        }
                    replies.push(reply);
                });
                self.sendQuickReply(sender, message.quickReplies.title, replies);
                break;
            case "image": //image
                self.sendImageMessage(sender, message.image.imageUri);
                break;
        }
    },

    /*
        send card list event
     */
    handleCardListMessages: function(recipientId,messages,buttons){
        let self = module.exports;
        let elements = [];
        let payload = {};
        let count = 0;
        for(let message of messages){
            if(count<4) {
                let element = {};
                element.title = message.remind_name;
                element.subtitle = message.remind_date + "  " + message.remind_time;
                element.image_url = 'https://cdn.iconscout.com/icon/free/png-256/reminder-6-119106.png';
                elements.push(element);
            }
            count++
        }
        if(buttons){
            console.log(buttons);
            payload =  {
                template_type: "list",
                top_element_style: "compact",
                elements: elements,
                buttons:buttons,
            };
        }else{
            console.log(2);
            payload =  {
                template_type: "list",
                top_element_style: "compact",
                elements: elements,
            };
        }

        console.log(payload);
        let messageData = {
            recipient: {
                id: recipientId
            },
            message: {
                attachment: {
                    type: "template",
                    payload: payload
                }
            }
        };
        self.callSendAPI(messageData);


    },
    /*
     * handle generic card template send
     */
    handleGenericTemplate: function(recipientId,messages,button){
        let img_url = "https://www.reputationmanagement.com/wp-content/uploads/2017/12/remove_search_results_from_google.jpg";
        if(button === undefined){
            img_url = "https://nifa.aero/wp-content/uploads/reminder-1024x638.gif";

        }else{
            if(button[0].title === 'Accept'){
                img_url = "http://n.sinaimg.cn/tech/20151119/NR-M-fxkwuwx0186942.jpg";
            }
        }
        let self = module.exports;
        let payload = {};
        let count = 0;
        let elements = [];
        let element = {};
        if(messages.length === 1) {
            element.title = messages[0].remind_name;
            element.subtitle = messages[0].remind_date + "  " + messages[0].remind_time;
            element.image_url = img_url;
            element.buttons = button;
            elements.push(element);
        }else{
            element.title = messages.length + " Reminders";
            let subTitle = "";
            for(let i=0; i<messages.length; i++){
                if(i===messages.length-1){
                    subTitle +=  messages[i].remind_name+"("+messages[i].remind_date+" "+messages[i].remind_time+")";
                }else{
                    subTitle +=  messages[i].remind_name+"("+messages[i].remind_date+" "+messages[i].remind_time+")" + ', ';
                }
            }
            element.subtitle = subTitle;
            element.image_url = 'https://www.reputationmanagement.com/wp-content/uploads/2017/12/remove_search_results_from_google.jpg';
            element.buttons = button;
            elements.push(element);
        }
        payload =  {
            template_type: "generic",
            elements: elements
        };
        let messageData = {
            recipient: {
                id: recipientId
            },
            message: {
                attachment: {
                    type: "template",
                    payload: payload
                }
            }
        };
        console.log(payload)
        self.callSendAPI(messageData);

    },
    handleCardMessages: function(messages, sender) {

        let self = module.exports;
        let elements = [];
        for (var m = 0; m < messages.length; m++) {
            let message = messages[m];

            let buttons = [];
            for (var b = 0; b < message.card.buttons.length; b++) {
                let isLink = (message.card.buttons[b].postback.substring(0, 4) === 'http');
                let button;
                if (isLink) {
                    button = {
                        "type": "web_url",
                        "title": message.card.buttons[b].text,
                        "url": message.card.buttons[b].postback
                    }
                } else {
                    button = {
                        "type": "postback",
                        "title": message.card.buttons[b].text,
                        "payload": message.card.buttons[b].postback
                    }
                }
                buttons.push(button);
            }


            let element = {
                "title": message.card.title,
                "image_url":message.card.imageUri,
                "subtitle": message.card.subtitle,
                "buttons": buttons
            };
            elements.push(element);
        }

        self.sendGenericMessage(sender, elements);
    },

    /*
     * Message Read Event
     *
     * This event is called when a previously-sent message has been read.
     * https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-read
     *
     */
    receivedMessageRead: function(event) {
        var senderID = event.sender.id;
        var recipientID = event.recipient.id;

        // All messages before watermark (a timestamp) or sequence have been seen.
        var watermark = event.read.watermark;
        var sequenceNumber = event.read.seq;

        console.log("Received message read event for watermark %d and sequence " +
            "number %d", watermark, sequenceNumber);
    },

    /*
     * Authorization Event
     *
     * The value for 'optin.ref' is defined in the entry point. For the "Send to
     * Messenger" plugin, it is the 'data-ref' field. Read more at
     * https://developers.facebook.com/docs/messenger-platform/webhook-reference/authentication
     *
     */
    receivedAuthentication: function(event) {
        var senderID = event.sender.id;
        var recipientID = event.recipient.id;
        var timeOfAuth = event.timestamp;
        let self = module.exports;
        // The 'ref' field is set in the 'Send to Messenger' plugin, in the 'data-ref'
        // The developer can set this to an arbitrary value to associate the
        // authentication callback with the 'Send to Messenger' click event. This is
        // a way to do account linking when the user clicks the 'Send to Messenger'
        // plugin.
        var passThroughParam = event.optin.ref;

        console.log("Received authentication for user %d and page %d with pass " +
            "through param '%s' at %d", senderID, recipientID, passThroughParam,
            timeOfAuth);

        // When an authentication is received, we'll send a message back to the sender
        // to let them know it was successful.
        self.sendTextMessage(senderID, "Authentication successful");
    },

    /*
     * Verify that the callback came from Facebook. Using the App Secret from
     * the App Dashboard, we can verify the signature that is sent with each
     * callback in the x-hub-signature field, located in the header.
     *
     * https://developers.facebook.com/docs/graph-api/webhooks#setup
     *
     */
    verifyRequestSignature: function(req, res, buf) {
        var signature = req.headers["x-hub-signature"];
        console.log('verifyRequestSignature');
        if (!signature) {
            throw new Error('Couldn\'t validate the signature.');
        } else {
            var elements = signature.split('=');
            var method = elements[0];
            var signatureHash = elements[1];

            var expectedHash = crypto.createHmac('sha1', config.FB_APP_SECRET)
                .update(buf)
                .digest('hex');

            if (signatureHash != expectedHash) {
                throw new
                Error("Couldn't validate the request signature.");
                console.log("Couldn't validate the request signature.");
            }
        }
    },

    /*
     * Send a message with Quick Reply buttons.
     *
     */
    sendQuickReply: function(recipientId, text, replies, metadata) {
        let self = module.exports;
        var messageData = {
            recipient: {
                id: recipientId
            },
            message: {
                text: text,
                metadata: self.isDefined(metadata)?metadata:'',
                quick_replies: replies
            }
        };

        self.callSendAPI(messageData);
    },

    /*
     * Send an image using the Send API.
     *
     */
    sendImageMessage: function(recipientId, imageUrl) {
        let self = module.exports;
        var messageData = {
            recipient: {
                id: recipientId
            },
            message: {
                attachment: {
                    type: "image",
                    payload: {
                        url: imageUrl
                    }
                }
            }
        };

        self.callSendAPI(messageData);
    },

    /*
     * Send a button message using the Send API.
     *
     */
    sendButtonMessage: function(recipientId, text, buttons) {
        let self = module.exports;
        var messageData = {
            recipient: {
                id: recipientId
            },
            message: {
                attachment: {
                    type: "template",
                    payload: {
                        template_type: "button",
                        text: text,
                        buttons: buttons
                    }
                }
            }
        };

        self.callSendAPI(messageData);
    },

    sendGenericMessage: function(recipientId, elements) {
        let self = module.exports;
        var messageData = {
            recipient: {
                id: recipientId
            },
            message: {
                attachment: {
                    type: "template",
                    payload: {
                        template_type: "generic",
                        elements: elements
                    }
                }
            }
        };

        self.callSendAPI(messageData);
    },
    /*
     * Turn typing indicator on
     *
     */
    sendTypingOn: function(recipientId) {
        let self = module.exports;
        console.log("Turning typing indicator on");

        var messageData = {
            recipient: {
                id: recipientId
            },
            sender_action: "typing_on"
        };

        self.callSendAPI(messageData);
    },

    /*
     * Turn typing indicator off
     *
     */
    sendTypingOff: function(recipientId) {
        let self = module.exports;
        console.log("Turning typing indicator off");
        var messageData = {
            recipient: {
                id: recipientId
            },
            sender_action: "typing_off"
        };

        self.callSendAPI(messageData);
    },

    sendTextMessage: function(recipientId, text) {
        let self = module.exports;
        var messageData = {
            recipient: {
                id: recipientId
            },
            message: {
                text: text
            }
        }
        self.callSendAPI(messageData);
    },


    /*
     * Call the Send API. The message data goes in the body. If successful, we'll
     * get the message id in a response
     *
     */
    callSendAPI: function(messageData) {
        request({
            uri: 'https://graph.facebook.com/v2.6/me/messages',
            qs: {
                access_token: config.FB_PAGE_TOKEN
            },
            method: 'POST',
            json: messageData

        }, function (error, response, body) {
            if (!error && response.statusCode == 200) {
                var recipientId = body.recipient_id;
                var messageId = body.message_id;

                if (messageId) {
                    console.log("Successfully sent message with id %s to recipient %s",
                        messageId, recipientId);
                } else {
                    console.log("Successfully called Send API for recipient %s",
                        recipientId);
                }
            } else {
                console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
            }
        });
    },

    isDefined: function(obj) {
        if (typeof obj == 'undefined') {
            return false;
        }

        if (!obj) {
            return false;
        }

        return obj != null;
    }

}