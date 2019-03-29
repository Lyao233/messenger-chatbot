'use strict';
const request = require('request');
const config = require('../config');
const pg = require('pg');
pg.defaults.ssl = true;

module.exports = {

    addUser: function(callback, userId) {
        request({
            uri: 'https://graph.facebook.com/v3.2/' + userId,
            qs: {
                access_token: config.FB_PAGE_TOKEN
            }

        }, function (error, response, body) {
            if (!error && response.statusCode == 200) {
                var user = JSON.parse(body);
                if (user.first_name.length > 0) {
                    var pool = new pg.Pool(config.PG_CONFIG);
                    pool.connect(function(err, client, done) {
                        if (err) {
                            return console.error('Error acquiring client', err.stack);
                        }
                        var rows = [];
                        client.query(`SELECT fb_id FROM users WHERE fb_id='${userId}' LIMIT 1`,
                            function(err, result) {
                                if (err) {
                                    console.log('Query error: ' + err);
                                } else {
                                    if (result.rows.length === 0) {
                                        let sql = 'INSERT INTO users (fb_id, first_name, last_name, profile_pic) ' +
                                            'VALUES ($1, $2, $3, $4)';
                                        client.query(sql,
                                            [
                                                userId,
                                                user.first_name,
                                                user.last_name,
                                                user.profile_pic
                                            ]);
                                    }
                                }
                            });

                        callback(user);
                    });
                    pool.end();
                } else {
                    console.log("Cannot get data for fb user with id",
                        userId);
                }
            } else {
                console.error(response.error);
            }

        });
    },

    addReminder: function(callback, userId, params) {
        let pool = new pg.Pool(config.PG_CONFIG);
        console.log(params);
        pool.connect(function(err, client, done) {
            if (err) {
                return console.error('Error acquiring client', err.stack);
            }
            var rows = [];

            let sql = 'INSERT INTO reminders (fb_id, remind_name, remind_date, remind_time) ' +
                'VALUES ($1, $2, $3, $4)';
            client.query(sql,
                [
                    userId,
                    params.name,
                    params.date,
                    params.time,
                ]);

            callback(0);
        });
        pool.end();
    },

    getReminders: function(callback, param, userId) {
        let query = "SELECT id, fb_id, remind_name,remind_date, remind_time FROM reminders WHERE fb_id='"+userId+"'";

        if(param.hasOwnProperty('name') && param.name!==''){
            query += " AND remind_name LIKE '%"+param.name+"%'";
        }
        if(param.hasOwnProperty('date')&& param.date!==''){
            query += " AND remind_date='"+param.date+"'";
        }
        if(param.hasOwnProperty('time')&& param.time!==''){
            query += " AND remind_time='"+param.time+"'";
        }
        query += " ORDER BY remind_date ASC , remind_time ASC";
        let pool = new pg.Pool(config.PG_CONFIG);
        pool.connect(function(err, client, done) {
            if (err) {
                return console.error('Error acquiring client', err.stack);
            }
            client
                .query(
                    query,
                    function(err, result) {
                        if (err) {
                            console.log(err);
                            callback([]);
                        } else {
                            callback(result.rows);
                        }
                    });
        });
        pool.end();
    },
    getRecentReminder: function(callback, param, userId) {
        console.log(param);
        let query = "SELECT id, fb_id, remind_name,remind_date, remind_time FROM reminders WHERE fb_id='"+userId+"' " +
            "AND remind_date>'"+param.date+"' OR ( remind_date='"+param.date+"' AND remind_time>='"+param.time+"') ";

        query += "ORDER BY remind_date ASC , remind_time ASC LIMIT 1";
        let pool = new pg.Pool(config.PG_CONFIG);
        console.log(query);
        pool.connect(function(err, client, done) {
            if (err) {
                return console.error('Error acquiring client', err.stack);
            }
            client
                .query(
                    query,
                    function(err, result) {
                        if (err) {
                            console.log(err);
                            callback([]);
                        } else {
                            console.log(result.rows);
                            callback(result.rows);
                        }
                    });
        });
        pool.end();
    },
    removeReminders: function(callback, messages, userId) {
        let ids = "";
        for(let i=0; i< messages.length; i++){
            if(i === messages.length-1){
                ids += "("+messages[i].id+")";
            }else{
                ids += "("+messages[i].id+"),";
            }
        }
        let query = "DELETE FROM reminders USING (values "+ids+") AS tmp(id) WHERE reminders.id=tmp.id";
        console.log(query);
        let pool = new pg.Pool(config.PG_CONFIG);
        pool.connect(function(err, client, done) {
            if (err) {
                return console.error('Error acquiring client', err.stack);
            }
            client
                .query(
                    query,
                    function(err, result) {
                        if (err) {
                            console.log(err);
                            callback([]);
                        } else {
                            callback(result.rows);
                        }
                    });
        });
        pool.end();
    },
    updateReminders: function(callback, param, reminderId) {
        let query = "UPDATE reminders SET";

        if(param.hasOwnProperty('date') && param.name!==''){
            query += " remind_date='"+param.date+"'";
            if(param.hasOwnProperty('time')&& param.date!==''){
                query += ", remind_time='"+param.time+"'";
            }
        }else{
            if(param.hasOwnProperty('time')&& param.date!==''){
                query += "remind_time='"+param.time+"'";
            }
        }

        query += " WHERE id='"+reminderId+"'";
        console.log(query);
        let pool = new pg.Pool(config.PG_CONFIG);
        pool.connect(function(err, client, done) {
            if (err) {
                return console.error('Error acquiring client', err.stack);
            }
            client
                .query(
                    query,
                    function(err, result) {
                        if (err) {
                            console.log(err);
                            callback(false);
                        } else {
                            callback(true);
                        }
                    });
        });
        pool.end();
    }

};