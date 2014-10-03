/*jslint browser: true, sloppy: true */

(function () {
    var CallError, SessionError, orca;

    /**
    * @private
    * @summary Create a unique ID string
    */
    function generateCallId() {
        var i, id = '', an = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (i = 0; i < 8; i += 1) {
            id += an.charAt(Math.floor(Math.random() * an.length));
        }
        return id;
    }

    /**
    * @private
    * @summary Enable or disable all in a list of tracks
    */
    function setTrackListEnabled(tracklist, value) {
        var i;
        for (i = 0; i < tracklist.length; i += 1) {
            tracklist[i].enabled = value;
        }
    }

    /**
    * @private
    * @summary Filter a list of MediaStreams according to criteria
    */
    function selectStreams(list, result, id, audio, video) {
        var i, stream;
        for (i = 0; i < list.length; i += 1) {
            stream = list[i].stream();
            if ((id === '' || stream.id === id) &&
                    (!audio || stream.getAudioTracks().length > 0) &&
                    (!video || stream.getVideoTracks().length > 0)) {
                result.push(list[i]);
            }
        }
    }

    /**
    * @summary Event emitter module
    * @constructor
    * @memberOf orca
    * @param {Session|Call|object} context the scope in which to call listener functions
    */
    function Emitter(context) {
        var callbacks = [];
        if (!context) {
            context = window;
        }

        /**
        * @private
        * @summary Validate and clean event string
        */
        function sanitizeEvent(event) {
            if (typeof event === 'string') {
                event = event.replace(/^\s+|\s+$/g, '');
                return event;
            }
            return '';
        }

        /**
        * @private
        * @summary Determine if the trigger event qualifies for the target event
        */
        function isTrigger(trigger, target) {
            if (target === '*') {
                return true;
            }
            if (target[target.length - 1] === '*') {
                return (trigger.indexOf(target.substring(0, target.length - 1)) === 0);
            }
            return trigger === target;
        }

        this.on = function (event, handler) {
            event = sanitizeEvent(event);
            if (event !== '' && typeof handler === 'function') {
                callbacks.push({event: event, handler: handler});
            }
            return this;
        };

        this.once = function (event, handler) {
            event = sanitizeEvent(event);
            if (event !== '' && typeof handler === 'function') {
                callbacks.push({event: event, handler: handler, once: true});
            }
            return this;
        };

        this.off = function (event, handler) {
            var i = 0;
            if (!event) {
                event = '*';
            }
            while (i < callbacks.length) {
                if (isTrigger(event, callbacks[i].event) &&
                        (typeof handler !== 'function' || handler === callbacks[i].handler)) {
                    callbacks.splice(i, 1);
                } else {
                    i += 1;
                }
            }
            return this;
        };

        this.emit = function (event, eventInfo) {
            var i = 0, hasListeners = false;
            if (eventInfo && typeof eventInfo === 'object') {
                eventInfo.type = event;
            } else {
                eventInfo = { type: event };
            }
            while (i < callbacks.length) {
                if (isTrigger(event, callbacks[i].event)) {
                    callbacks[i].handler.apply(context, [eventInfo]);
                    hasListeners = true;
                    if (callbacks[i].once) {
                        callbacks.splice(i, 1);
                    } else {
                        i += 1;
                    }
                } else {
                    i += 1;
                }
            }
            return hasListeners;
        };

    }



    /** 
    * @summary Provides access to media control functions during a call
    * @constructor
    * @memberOf orca
    * @param {RTCMediaStream} rtcMediaStream the underlying WebRTC runtime MediaStream instance 
    */
    function ManagedStream(rtcMediaStream) {

        /**
        * @summary Gets the type of media associated with this instance
        * (Isn't 'type' at track level? Can't media streams contain both audio and video? )
        * @returns {String}
        */
        this.type = function () {
            var a = rtcMediaStream.getAudioTracks().length > 0,
                v = rtcMediaStream.getVideoTracks().length > 0;
            return a ? (v ? 'audio,video' : 'audio') : (v ? 'video' : '');
        };

        /**
        * @summary Restarts transmission of the media content after it has been stopped
        */
        this.resume = function () {
            setTrackListEnabled(rtcMediaStream.getAudioTracks(), true);
            setTrackListEnabled(rtcMediaStream.getVideoTracks(), true);
        };

        /**
        * @summary Halts transmission of the media content during a call
        */
        this.stop = function () {
            setTrackListEnabled(rtcMediaStream.getAudioTracks(), false);
            setTrackListEnabled(rtcMediaStream.getVideoTracks(), false);
        };

        /**
        * Gets the underlying WebRTC MediaStream
        * @returns {RTCMediaStream}
        */
        this.stream = function () {
            return rtcMediaStream;
        };
    }



    /**
    * @summary Provides access to methods for managing an outgoing or incoming call
    * @classdesc Calls objects are obtained by calling the createCall method or handling the onIncoming event of a connected {@Link orca.Session} instance
    * @Constructor
    * @memberOf orca
    */
    function Call(to, mediatypes, sessionImp, isIncoming) {
        var callImp, callId;

        // STUB ONLY: Externally trigger a Call event
        this.triggerEvent = function (status, data) {
            callImp.triggerEvent(status, data);
        };

        /**
        * Gets a unique identifier for the call 
        * @type {String}
        */
        this.id = function () {
            return callId;
        };

        /**
        * Gets the identities of the remote peers attached to this call
        * @returns {PeerIdentity[]}
        */
        this.remoteIdentities = function () {
            return callImp.remoteIdentities();
        };

        /**
        * Adds a local media stream to the call
        * Media stream instances are obtained from the browser's getUserMedia() method.
        * Local media streams should be added using this method before the connect method 
        * is called to either initiate a new call or answer a received call.
        * (NOTE: Possible to accept RTCMediaStream as parameter to this method and
        * create ManagedStream internally)
        * @param {orca.ManagedStream} stream local media stream 
        */
        this.addStream = function (stream) {
            var managed = stream;
            if (stream !== null) {
                if (stream.constructor.name !== 'ManagedStream') {
                    managed = orca.createManagedStream(stream);
                }
                callImp.addStream(managed);
                return managed;
            }
        };

        /**
        * Attempts to reach the call recipient and establish a connection
        * For an incoming call, calling this method explicitly joins/accepts the call
        */
        this.connect = function () {
            return callImp.connect();
        };

        /**
        * Ends an active call
        */
        this.disconnect = function () {
            return callImp.disconnect();
        };

        /**
        * Called when a user does not wish to accept an incoming call
        */
        this.reject = function () {
            return callImp.reject();
        };

        /**
        * Retrieves a list of streams associated with this call.
        * The return value is an array of ManagedStream instances with undefined order
        * When no selector parameter is provided all local and remote streams are included
        * in the returned array.
        * The keywords *local* and *remote* can be specified to limit the results to local or 
        * remote streams respectively.
        * The *.* (period) symbol is used to prefix a keyword used to limit the results by the
        * stream type.  E.g. ".video" would be used to return a list of video streams only.
        * The *#* (pound) symbol is used to prefix label text used to limit the results to a 
        * to a single stream with a label matching the specified text.
        * 
        * @param {string} selector optional query to filter the result list
        * @returns {orca.ManagedStream[]}
        * @example
        * // Get list of all local streams
        * var localStreams = call.streams("local");
        *
        * // Get list of all audio streams
        * var audioStreams = call.streams(".audio");
        * 
        * // Get stream with by its label name
        * // If successful only one match should be
        * // returned
        * var stream0 = call.streams("#stream_0");
        * if (stream0 && stream0.length == 1) {
        * ...
        * }
        * 
        * // Possible to support combined selections?
        * // Get list of local audio streams
        * var localAudio = call.streams("local.audio");
        */
        this.streams = function (selector) {
            var result = [], el = '', id = '', audio = false, video = false;
            if (selector && typeof selector === 'string') {
                el = selector.match(/^[0-9a-zA-Z]*/)[0].toLowerCase();
                id = selector.match(/#[0-9a-zA-Z]*/);
                if (id) {
                    id = id[0].substring(1);
                } else {
                    id = '';
                }
                audio = selector.match(/\.audio([#.\s]|$)/) ? true : false;
                video = selector.match(/\.video([#.\s]|$)/) ? true : false;
            }
            if (el !== 'local') {
                selectStreams(callImp.remoteStreams(), result, id, audio, video);
            }
            if (el !== 'remote' && callImp && typeof callImp.remoteStreams === 'function') {
                selectStreams(callImp.localStreams(), result, id, audio, video);
            }
            return result;
        };

        /**
        * Retrieves the current status of this call
        * @returns {CallStatus}
        */
        this.getStatus = function () {
            return callImp.getStatus();
        };

        /**
        * @summary Adds a listener for a call event
        * Valid event names are:
        *   "connected" 
        *        Triggered when a call is connected
        *   "disconnected" 
        *        Triggered when a call is disconnected
        *   "error" - (Arguments: {CallError} Indicates the error that caused the event)
        *        Triggered when an error condition occurs 
        *   "stream:add" (Arguments: {orca.ManagedStream} remote media stream)
        *        Triggered when a remote stream is added to the call
        *   "connecting" - 
        *        Triggered when a call has initiated an attempt to connect to a remote party 
        *   "hold" - 
        *        Triggered when a call is placed on hold
        *   "unhold" - 
        *        Triggered when a call is taken off hold
        *   "rejected" - 
        *        Triggered when an attempt to connect a call is explicitly rejected by the remote party
        * @event
        * @param {String} event name of the event
        * @param {Function} handler function to be called when event is raised
        * @return {orca.Call} 
        */
        this.on = function (event, handler) {
            callImp.emitter.on(event, handler);
        };

        /**
        * @summary Adds a listener for a call event that will be called once
        * @event
        * @param {String} event name of the event
        * @param {Function} handler function to be called when event is raised
        * @return {orca.Call}
        */
        this.once = function (event, handler) {
            callImp.emitter.once(event, handler);
        };

        /**
        * @summary Removes a listener for a call event
        * @event
        * @param {String} event name of the event
        * @param {Function} handler function to be called when event is raised
        * @return {orca.Call} 
        */
        this.off = function (event, handler) {
            callImp.emitter.off(event, handler);
        };

        // Call Construction
        callImp = sessionImp.createCall(to, mediatypes, sessionImp, this, isIncoming);
        callImp.emitter = new Emitter(this);
        callId = generateCallId();
    }

    /**
    * @classdesc Session objects are obtained by calling the createSession method of the global {@Link orca} object
    * @summary Manages communications for a given user identity
    * @constructor
    * @memberOf orca
    */
    function Session(userid, token, sessionConfig) {
        var sessionImp;

        // STUB ONLY: Externally trigger a Session event
        this.triggerEvent = function (status, from, mediatypes) {
            var call;
            if (from) {
                if (this.getStatus() === 'connected') {
                    call = this.createCall(from, mediatypes, true);
                    sessionImp.triggerEvent('incomingCall', call);
                    return call;
                }
            } else {
                sessionImp.triggerEvent(status);
            }
        };

        /**
        * Activates the communications session with a gateway server
        * @method
        */
        this.connect = function () {
            return sessionImp.connect();
        };

        /**
        * Creates a new call instance for communication with the specified recipient
        * @param {String} to the user identifier of the call recipient
        * @param {String} mediatypes Comma separated list of media stream types to be used during the call Eg. "audio,video"
        */
        // STUB ONLY: Use isIncoming parameter to trigger an incoming call
        this.createCall = function (to, mediatypes, isIncoming) {
            return new Call(to, mediatypes, sessionImp, isIncoming);
        };

        /**
        * Ends and active communications session with a gateway server
        */
        this.disconnect = function () {
            return sessionImp.disconnect();
        };

        /**
        * @summary Retrieves the current status of this session
        * @returns String
        */
        this.getStatus = function () {
            return sessionImp.getStatus();
        };

        /**
        * @summary Adds a listener for a session event
        * Valid event names are:
        *   "connected" 
        *        Triggered when the session is connected successfully
        *   "disconnected" 
        *        Triggered when the session is disconnected
        *   "error" - (Arguments: {SessionError} indicates the error that caused the event)
        *        Triggered when an error condition occurs 
        *   "incomingCall" (Arguments: {orca.Call} incoming call object)
        *        Triggered when an incoming communication is received during an active session
        *   "connecting" - 
        *        Triggered when a session is in the process of being established 
        * @event
        * @param {String} event name of the event
        * @param {Function} handler function to be called when event is raised
        * @return {orca.Session} 
        *
        */
        this.on = function (event, handler) {
            sessionImp.emitter.on(event, handler);
        };

        /**
        * @summary Adds a listener for a session event that will be called once
        * @event
        * @param {String} event name of the event
        * @param {Function} handler function to be called when event is raised
        * @return {orca.Session}
        */
        this.once = function (event, handler) {
            sessionImp.emitter.once(event, handler);
        };

        /**
        * @summary Removes a listener for a session event
        * @event
        * @param {String} event name of the event
        * @param {Function} handler function to be called when event is raised
        * @return {orca.Session}
        */
        this.off = function (event, handler) {
            sessionImp.emitter.off(event, handler);
        };

        // Session Construction
        sessionImp = sessionConfig.provider.createSession(userid, token, sessionConfig, this);
        sessionImp.emitter = new Emitter(this);
    }

    /**
    * @summary Possible errors associated with a orca.Call
    * @typedef CallError
    * @type enum 
    * @property {String} NETWORK_ERROR An error has occured 
    */
    CallError = {};
    CallError.NETWORK_ERROR = 0;

    /**
    * @summary Provides information about an event
    * @typedef Event
    * @type object 
    * @property {String} name Gets the name/type indicator of the event
    */

    /**
    * @summary Provides information about the identity of a communications peer
    * @typedef PeerIdentity
    * @type object 
    * @property {String} id the unique identifier or address string of the associated user
    */

    /**
    * @summary Possible errors associated with a orca.Session
    * @typedef SessionError
    * @type enum 
    * @property {String} AUTHENTICATION_FAILED User credentials are invalid
    * @property {String} NETWORK_ERROR No response recieved within maximum expected time
    */
    SessionError = {};
    SessionError.NETWORK_ERROR = 0;
    SessionError.AUTHENTICATION_FAILED = 1;

    /**
    * @summary Configuration properties for a orca.Session
    * @typedef SessionConfig
    * @type object 
    * @property {String} uri The address of the gateway server
    * @property {Object} provider Reference to implementation providing actual functionality
    * @property {String} mediatypes The types of media streams that the created session will support; defaults if not provided
    */

    /** 
    * @summary root namespace of the call control SDK
    * @global
    * @namespace 
    */
    orca = {
        /**
        * allow creation of multiple sessions in a single page; 
        * possibly limit repeated registrations using the same identity
        * @param {userid} userid The user's unique identifier
        * @param {token} token An authorization token associated with the provided userid
        * @param {SessionConfig} sessionConfig session initialization parameters
        * @returns {orca.Session}
        */
        createSession: function (userid, token, sessionConfig) {
            return new Session(userid, token, sessionConfig);
        },

        /**
        * Create a reference to a WebRTC media stream that can be attached 
        * to a call
        * @param {RTCMediaStream} rtcMediaStream Browser media stream
        * @returns {orca.ManagedStream}
        */
        createManagedStream: function (rtcMediaStream) {
            return new ManagedStream(rtcMediaStream);
        }

    };

    this.orca = orca;
    this.Session = Session;
    this.CallError = CallError;
    this.SessionError = SessionError;

}());
