'use strict';
const createError = require('http-errors');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const bodyParser = require('body-parser');

const app = express();

const apiai = require('apiai');
const config = require('./config');
const moment = require('moment');
const timezone = require('moment-timezone');
const uuid = require('uuid');

const fbService = require('./services/facebookService');
const userService = require('./services/userService');
const apiaiApp  = apiai(config.APIAI_ACCESS_TOKEN);


// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
//verify request came from facebook
app.use(bodyParser.json({
  verify: verifyRequestSignature
}));
//serve static files in the public directory
app.use(express.static('public'));
// Process application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({
  extended: false
}));
// Process application/json
app.use(bodyParser.json());

const scheduleMap = new Map();
const alertingMap = new Map();

// Messenger API parameters
if (!config.FB_PAGE_TOKEN) {
  throw new Error('missing FB_PAGE_TOKEN');
}
if (!config.FB_VERIFY_TOKEN) {
  throw new Error('missing FB_VERIFY_TOKEN');
}
if (!config.GOOGLE_PROJECT_ID) {
  throw new Error('missing GOOGLE_PROJECT_ID');
}
if (!config.DF_LANGUAGE_CODE) {
  throw new Error('missing DF_LANGUAGE_CODE');
}
if (!config.GOOGLE_CLIENT_EMAIL) {
  throw new Error('missing GOOGLE_CLIENT_EMAIL');
}
if (!config.GOOGLE_PRIVATE_KEY) {
  throw new Error('missing GOOGLE_PRIVATE_KEY');
}
if (!config.FB_APP_SECRET) {
  throw new Error('missing FB_APP_SECRET');
}
if (!config.SERVER_URL) { //used for ink to static files
  throw new Error('missing SERVER_URL');
}

const sessionIds = new Map();
const usersMap = new Map();
const deleteListMap = new Map();
const userReminderListMap = new Map();

app.get('/', function (req, res) {
  res.send('Hello, I am lan\'s chat bot')
})

/* GET users listing. */
app.get('/webhook/', function(req,res){
  console.log("request");
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === config.FB_VERIFY_TOKEN) {
    res.status(200).send(req.query['hub.challenge']);
  } else {
    console.error("Failed validation. Make sure the validation tokens match.");
    res.sendStatus(403);
  }
})

app.post('/webhook/', function(req,res){
  const data = req.body;
  console.log(JSON.stringify(data));
  // Make sure this is a page subscription
  if (data.object == 'page') {
    // Iterate over each entry
    // There may be multiple if batched
    data.entry.forEach(function (pageEntry) {
      const pageID = pageEntry.id;
      const timeOfEvent = pageEntry.time;

      // Iterate over each messaging event
      pageEntry.messaging.forEach(function (messagingEvent) {
        if (messagingEvent.option) {
          fbService.receivedAuthentication(messagingEvent);
        } else if (messagingEvent.message) {
          receivedMessage(messagingEvent);
        } else if (messagingEvent.postback) {
          receivedPostback(messagingEvent);
        } else if (messagingEvent.read) {
          receivedMessageRead(messagingEvent);
        } else {
          console.log("Webhook received unknown messagingEvent: ", messagingEvent);
        }
      });
    });

    // Assume all went well.
    // You must send back a 200, within 20 seconds
    res.sendStatus(200);
  }
});

function receivedMessage(event) {

  const senderID = event.sender.id;
  const recipientID = event.recipient.id;
  const timeOfMessage = event.timestamp;
  const message = event.message;

  setSessionAndUser(senderID);
  //console.log("Received message for user %d and page %d at %d with message:", senderID, recipientID, timeOfMessage);
  //console.log(JSON.stringify(message));

  const isEcho = message.is_echo;
  const messageId = message.mid;
  const appId = message.app_id;
  const metadata = message.metadata;

  // You may get a text or attachment but not both
  const messageText = message.text;
  const messageAttachments = message.attachments;
  const quickReply = message.quick_reply;

  if (isEcho) {
    fbService.handleEcho(messageId, appId, metadata);
    return;
  } else if (quickReply) {
    fbService.handleQuickReply(senderID, quickReply, messageId);
    return;
  }

  if (messageText) {
    console.log("senderId"+": "+senderID);
    //send message to api.ai
    sendTextQueryToDialogFlow(sessionIds,senderID, messageText);
  } else if (messageAttachments) {
    fbService.handleMessageAttachments(messageAttachments, senderID);
  }
}

/*
 * Postback Event
 *
 * This event is called when a postback is tapped on a Structured Message.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/postback-received
 *
 */
function receivedPostback(event) {
  const senderID = event.sender.id;
  const recipientID = event.recipient.id;
  const timeOfPostback = event.timestamp;

  fbService.sendTypingOn(senderID);

  // The 'payload' param is a developer-defined field which is set in a postback
  // button for Structured Messages.
  const payload = event.postback.payload;
  fbService.sendTypingOff(senderID);

  if(payload === 'GET_STARTED'){
    setSessionforGetStart(function(user){
      let buttons = [
        {
          type:"postback",
          title:"Create a reminder",
          payload:"CREATE_REMINDER"
        }
      ];
      fbService.sendButtonMessage(senderID,"Hello "+user.first_name+", I am your personal reminder, for getting start," +
          "you can tell me when and what I need to remind. You can click the button blow for a quick start", buttons);
    }, senderID);
  }else{
    setSessionAndUser(senderID);
    switch (payload) {
      case 'CREATE_REMINDER':
        sendTextQueryToDialogFlow(sessionIds,senderID, "Create reminder");
        break;
      case 'NEXT_PAGE':
        let array = userReminderListMap.get(senderID);
        if(array.length>4){
          let buttons = [{
            type: "postback",
            title:"Next Page",
            payload:"NEXT_PAGE",
          }];
          array = array.splice(0,4);
          userReminderListMap.set(senderID,array);
          fbService.handleCardListMessages(senderID, array,buttons);
        }else{
          fbService.sendTextMessage(senderID, "Here is your reminders:");
          fbService.handleCardListMessages(senderID, array);
        }
        break;
      case 'REMINDER_ACCEPT':
        alertingMap.delete(senderID);
        fbService.sendTypingOff();
        break;
      case 'CHECK_UPCOMING_REMINDER':
        let curr_time = getCurrentDateTime();
        userService.getRecentReminder(function (e) {
          if(e.length>0) {
            fbService.sendTextMessage(senderID, "Here is your upcoming event.");
            fbService.handleGenericTemplate(senderID, e);
          }else{
            let buttons = [
              {
                type:"postback",
                title:"Create a reminder",
                payload:"CREATE_REMINDER"
              }
            ];
            fbService.sendButtonMessage(senderID,"Sorry, I cannot find any reminder matched, would you like to create one?", buttons);
          }
        },curr_time,senderID);
        break;
      case'REMINDER_SNOOZE':
        sendTextQueryToDialogFlow(sessionIds,senderID, "Snooze");
        break;
      case 'SHOW_TODAY':
        const today = timezone().tz('America/Chicago').format('YYYY-MM-DD');
        let param = {};
        param.date = today.toString();
        userService.getReminders(function (e) {
          if(e.length>0) {
            // messenger list template handles max 4 elements
            if(e.length>4){
              let buttons = [{
                type: "postback",
                title:"Next Page",
                payload:"NEXT_PAGE",
              }];
              let array = e;
              let rest_reminders = array.splice(0,4);
              userReminderListMap.set(senderID,array);
              fbService.handleCardListMessages(senderID, rest_reminders,buttons);
            }else{
              fbService.sendTextMessage(senderID, "Here is your reminders:");
              fbService.handleCardListMessages(senderID, e);
            }
          }else{
            let buttons = [
              {
                type:"postback",
                title:"Create a reminder",
                payload:"CREATE_REMINDER"
              }
            ];
            fbService.sendButtonMessage(senderID,"Sorry, I cannot find any reminder matched, would you like to create one?", buttons);
          }
        },param,senderID);
        break;
      case 'KEEP_REMINDER':
        deleteListMap.set(senderID,'');
        fbService.sendTextMessage(senderID,"Okay, I'll keep it");
        break;
      case 'REMOVE_REMINDER':
        if(deleteListMap.get(senderID).length<1){
          fbService.sendTextMessage(senderID,"Which reminder you want to remove?");
        }else {
          userService.removeReminders(function (e) {
                fbService.sendTextMessage(senderID, "Removed!");
                setReminder(senderID);
                deleteListMap.set(senderID,'');
              }
              , deleteListMap.get(senderID), senderID);
        }
        break;
      default:
        //unidentified payload
        fbService.sendTextMessage(senderID, "I'm not sure what you want. Can you be more specific?");
        break;
    }
    console.log("Received postback for user %d and page %d with payload '%s' " +
        "at %d", senderID, recipientID, payload, timeOfPostback);
  }
}


/*
 * Message Read Event
 *
 * This event is called when a previously-sent message has been read.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-read
 *
 */
function receivedMessageRead(event) {
  const senderID = event.sender.id;
  const recipientID = event.recipient.id;

  // All messages before watermark (a timestamp) or sequence have been seen.
  const watermark = event.read.watermark;
  const sequenceNumber = event.read.seq;

  console.log("Received message read event for watermark %d and sequence " +
      "number %d", watermark, sequenceNumber);
}

function handleDialogFlowResponse(sender, response) {
  let responseText = response.result.fulfillment.speech;

  let messages = response.result.fulfillment.messages;
  let action = response.result.action;
  let contexts = response.result.contexts;
  let parameters = response.result.parameters;
  let actionIncomplete = response.result.actionIncomplete;

  fbService.sendTypingOff(sender);

  if (fbService.isDefined(action)) {
    handleDialogFlowAction(sender, action, messages, contexts, parameters,actionIncomplete);
  } else if (fbService.isDefined(messages)) {
    fbService.handleMessages(messages[0].speech, sender);
  } else if (responseText == '' && !fbService.isDefined(action)) {
    //dialogflow could not evaluate input.
    fbService.sendTextMessage(sender, "I'm not sure what you want. Can you be more specific?");
  } else if (fbService.isDefined(responseText)) {
    fbService.sendTextMessage(sender, responseText);
  }
}

function sendTextQueryToDialogFlow(sessionIds, sender, text) {
  let request = apiaiApp.textRequest(text, {
    sessionId: sessionIds.get(sender),
    lang:config.DF_LANGUAGE_CODE
  });

  request.on('response', (response) => {
    handleDialogFlowResponse(sender,response)
  });

  request.on('error', (error) => {
    fbService.sendTextMessage(sender,"I am a little bit tired, may be we can talk later:(")
  });
  //It seems this line can prevent request stuck and I don't know why
  console.log('********');
  request.end();


}

function handleDialogFlowAction(sender, action, messages, contexts, parameters,allRequiredParamsPresent) {
  console.log(action);
  switch (action) {
    case 'reminders.add':
      if(!allRequiredParamsPresent){
        userService.addReminder(function (e) {
          fbService.sendTextMessage(sender,messages[0].speech);
          setReminder(sender);
        },sender,parameters);
      }else{
        console.log(sender);

        fbService.sendTextMessage(sender,messages[0].speech);
      }
      break;
    case 'reminders.get':
      userService.getReminders(function (e) {
        if(e.length>0) {
          // messenger list template handles max 4 elements
          if(e.length>4){
            let buttons = [{
              type: "postback",
              title:"Next Page",
              payload:"NEXT_PAGE",
            }];
            let array = e;
            let rest_reminders = array.splice(0,4);
            userReminderListMap.set(sender,array);
            fbService.handleCardListMessages(sender, rest_reminders,buttons);
          }else{
            fbService.sendTextMessage(sender, "Here is your reminders:");
            fbService.handleCardListMessages(sender, e);
          }
        }else{
          let buttons = [
            {
              type:"postback",
              title:"Create a reminder",
              payload:"CREATE_REMINDER"
            }
          ];
          fbService.sendButtonMessage(sender,"Sorry, I cannot find any reminder matched, would you like to create one?", buttons);
        }
      },parameters,sender);
      break;
    case 'reminders.remove':
      userService.getReminders(function (e) {
        let buttons = [
          {
            type:"postback",
            title:"Keep it",
            payload:"KEEP_REMINDER"
          },{
            type:"postback",
            title:"Remove",
            payload:"REMOVE_REMINDER"
          }
        ];
        deleteListMap.set(sender,e);
        if(e.length>1){
          fbService.sendTextMessage(sender,"Do you want to remove all these reminders?");
          fbService.handleGenericTemplate(sender,e,buttons);
        }else if(e.length ===1){
          fbService.sendTextMessage(sender,"Do you want to remove this reminder?");
          fbService.handleGenericTemplate(sender,e,buttons);
        }else{
          buttons = [
            {
              type:"postback",
              title:"Create a reminder",
              payload:"CREATE_REMINDER"
            }
          ];
          fbService.sendButtonMessage(sender,"Sorry, I cannot find any reminder matched, would you like to create one?", buttons);
        }
      },parameters,sender);
      break;
    case 'reminders.snooze':
      if(alertingMap.get(sender)){
        if(!allRequiredParamsPresent) {
          userService.updateReminders(function (e) {
            if (e) {
              alertingMap.delete(sender);
              fbService.sendTextMessage(sender, messages[0].speech);
              setReminder(sender);
            }
          }, parameters, alertingMap.get(sender));
        }else{
          fbService.sendTextMessage(sender,messages[0].speech);
        }
      }else{
        let buttons = [
          {
            type:"postback",
            title:"Upcoming Reminder",
            payload:"CHECK_UPCOMING_REMINDER",
          }
        ];
        fbService.sendButtonMessage(sender,"Sorry, you don't have a reminder alerting at this time. You" +
            " can check next upcoming event by clicking up this button.", buttons);
      }
      break;
    default:
      //unhandled action, just send back the text
      fbService.sendTextMessage(sender,messages[0].speech);
  }
}

function setSessionAndUser(senderID) {
  if (!sessionIds.has(senderID)) {
    sessionIds.set(senderID, uuid.v1());
  }
}

function setSessionforGetStart(callback,senderID) {
  if (!sessionIds.has(senderID)) {
    sessionIds.set(senderID, uuid.v1());
  }

  if (!usersMap.has(senderID)) {
    userService.addUser(function(user){
      usersMap.set(senderID, user);
      callback(user);
    }, senderID);
  }
}

function getCurrentDateTime(){
  const today = timezone().tz('America/Chicago').format('YYYY-MM-DD');
  const curr_time = timezone().tz('America/Chicago').format('HH:mm:ss');
  let param = {};
  param.date = today;
  param.time = curr_time;
  return param;
}



function setReminder(senderID){
  let param = getCurrentDateTime();
  userService.getRecentReminder(function (e) {
    if(e.length>0) {
      let buttons = [
        {
          type: "postback",
          title:"Accept",
          payload:"REMINDER_ACCEPT",
        },
        {
          type: "postback",
          title:"Snooze",
          payload:"REMINDER_SNOOZE",
        }
      ];
      let time = e[0].remind_date+" "+e[0].remind_time;
      let dateBegin = new Date(time.replace(/-/g, "/"));
      const today = timezone().tz('America/Chicago').format('YYYY-MM-DD HH:mm:ss');
      let dateEnd = new Date(today.replace(/-/g, "/"));
      console.log(time);
      let dateDiff = dateBegin.getTime()-dateEnd.getTime();
      console.log(dateDiff);
      if(scheduleMap.get(senderID)){
        clearTimeout(scheduleMap.get(senderID));
      }
      scheduleMap.set(senderID,setTimeout(function(){
        alertingMap.set(senderID,e[0].id);
        fbService.handleGenericTemplate(senderID,e,buttons);
        setTimeout(function(){setReminder(senderID)},10000);
        },dateDiff));
    }
  },param,senderID)
}

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});



module.exports = app;

function verifyRequestSignature(req, res, buf) {
  const signature = req.headers["x-hub-signature"];

  if (!signature) {
    throw new Error('Couldn\'t validate the signature.');
  } else {
    const elements = signature.split('=');
    const method = elements[0];
    const signatureHash = elements[1];

    const expectedHash = crypto.createHmac('sha1', config.FB_APP_SECRET)
        .update(buf)
        .digest('hex');

    if (signatureHash != expectedHash) {
      throw new Error("Couldn't validate the request signature.");
    }
  }
}
