/*jslint browser: true, devel: true, unparam: true, sloppy: true, todo: true */
/*global $, orca, orcaStub */

var requestMediaPerCall = true;
var users = {};
var currentId = null;
var addSessionCallbacks, removeSessionCallbacks, addCallCallbacks, removeCallCallbacks,
    getMyUserMedia, resetSessionUI, resetCallUI, callCleanup, hasUserAudio, hasUserVideo,
    onUserMediaSuccess, onUserMediaError;

function User(userId, pageId) {
    this.userId = userId;
    this.pageId = pageId;
    this.session = null;
    this.call = null;
    this.localStream = null;
    this.isIncomingCall = false;
}

function getRemoteParty(call) {
    // Get number from public ID
    var caller = call.remoteIdentities();
    if (caller && caller.length) {
        caller = caller[0].id;
    } else {
        caller = 'Unknown';
    }
    return caller;
}


//=============================================================
// Session Callbacks
//=============================================================

var SessionErrorMap = {
    '0': 'AUTHENTICATION_FAILED',
    '1': 'NETWORK_ERROR',
    '2': 'INVALID'
};

function session_onConnected(event) {
    var id = this.sid;
    console.log('session_onConnected ' + id);
    $('#' + id + ' .sessionStatus').html(event.type);
    $('#' + id + ' .sessionDisconnect').removeAttr('disabled');
    $('#' + id + ' .sessionConnect').attr('disabled', 'disabled');
    $('#' + id + ' .callButtons .callConnect').removeAttr('disabled');
    $('#' + id + ' .call').removeClass('disabled');
    if (!requestMediaPerCall) {
        getMyUserMedia(id, true);
    }
}

function session_onDisconnected(event) {
    var id = this.sid;
    console.log('session_onDisconnected ' + id);
    $('#' + id + ' .sessionStatus').html(event.type);
    if (users[id].localStream) {
        users[id].localStream.stop();
    }
    removeCallCallbacks(id);
    users[id].call = false;
    removeSessionCallbacks(id);
    users[id].session = false;
    resetSessionUI(id);
    resetCallUI(id, true);
}

function session_onError(event) {
    var id = this.sid;
    console.log('session_onError ' + id + ' ' + event.error);
    $('#' + id + ' .sessionStatus').html(event.type);
    $('#' + id + ' .error').html(SessionErrorMap[event.error] || event.error).show();
    if (users[id].localStream) {
        users[id].localStream.stop();
    }
    removeCallCallbacks(id);
    users[id].call = false;
    removeSessionCallbacks(id);
    users[id].session = false;
    resetSessionUI(id);
    resetCallUI(id, true);
}

function session_onIncoming(event) {
    var id = this.sid, caller;
    console.log('session_onIncoming ' + id);

    // STUB ONLY: Add a Session ID
    event.call.sid = this.sid;

    caller = getRemoteParty(event.call);
    users[id].isIncomingCall = true;
    users[id].call = event.call;
    addCallCallbacks(id);
    $('#' + id + ' .callStatus').html('<red>Incoming call</red>');
	$('#callee').val(caller);
    $('#' + id + ' .callButtons input').removeAttr('disabled')
            .filter('.callDisconnect').attr('disabled', 'disabled');
}

function session_onStatus(event) {
    var id = this.sid;
    console.log('session_onStatus ' + id + ' ' + event.status);
    $('#' + id + ' .sessionStatus').html(event.type);
}


//=============================================================
// Call Callbacks
//=============================================================

var CallErrorMap = {
    '0': 'NETWORK_FAILURE'
};

function call_onConnecting(event) {
    var id = this.sid;
    console.log('call_onConnecting ' + id);
    $('#' + id + ' .callStatus').html('connecting');
}

function call_onConnected(event) {
    var id = this.sid;
    console.log('call_onConnected ' + id);
    users[id].isIncomingCall = false;
    $('#' + id + ' .callStatus').html('In call');
    $('#' + id + ' .callButtons input').attr('disabled', 'disabled').filter('.callDisconnect').removeAttr('disabled');
}

function call_onAddStream(event) {
    var id = this.sid, url;
    console.log('call_onAddStream ' + id);
    url = window.nativeURL.createObjectURL(event.stream.stream());
    if (id) {
        $('#' + id + ' .remoteVideo').attr('src', url);
    } else {
        $('.remoteVideo[src=""]').attr('src', url);
    }
}

function call_onDisconnected(event) {
    var id = this.sid;
    console.log('call_onDisconnected ' + id);
    $('#' + id + ' .callStatus').html('disconnected');	
    callCleanup(id);
}

function call_onRejected(event) {
    var id = this.sid;
    console.log('call_onRejected ' + id);
    $('#' + id + ' .callStatus').html('rejected');
    callCleanup(id);
}

function call_onError(event) {
    var id = this.sid;
    console.log('call_onError ' + id + ' ' + event.error);
    $('#' + id + ' .sessionStatus').html(event.type);
    $('#' + id + ' .error').html(CallErrorMap[event.error] || event.error).show();
    callCleanup(id);
}

function callCleanup(id) {
    var i;
    if (!id) {
        for (i in users) {
            if (users.hasOwnProperty(i)) {
                callCleanup(i);
            }
        }
        return;
    }
    if (users[id]) {
        removeCallCallbacks(id);
        users[id].call = false;
        users[id].isIncomingCall = false;
        resetCallUI(id);
        if (requestMediaPerCall && users[id].localStream) {
            users[id].localStream.stop();
        }
    }
}


//=============================================================
// Session Commands
//=============================================================

function sessionConnect() {
    var id = $(this).closest('.user').attr('id'), sessionConfig;
	
	if ($('#userId').val().length == 0) {
		alert('Please fill in the User ID field to connect');
		return;
	}
    else users = {user1: new User($('#userId').val(), id)};

    console.log('sessionConnect ' + id);
    $('.ui-tooltip').remove();
    if (users[id]) {
        $('#' + id + ' .error').html('').hide();
        $('#' + id + ' .sessionConnect').attr('disabled', 'disabled');
		
		var iceServers = [];
		if ($('#stunServer').val() != '')
			iceServers.push({"url": $('#stunServer').val()});

		if ($('#turnServer').val() != '')
			iceServers.push({"url": $('#turnServer').val()});
	
			
        // Create Session
        sessionConfig = {
            uri: 'ws://' + $('#reflectorIP').val(),
            provider: orcaReflector,
            mediatypes: 'audio,video',
			hostilityhelper : {"iceServers": iceServers }
        };
        users[id].session = orca.createSession(users[id].userId, 'password', sessionConfig);

        // STUB ONLY: Add a Session ID
        users[id].session.sid = id;

        // Set Session callbacks
        addSessionCallbacks(id);

        // Connect
        users[id].session.connect();
    }
}

function sessionDisconnect() {
    var id = $(this).closest('.user').attr('id');
    $('.ui-tooltip').remove();
    if (users[id] && users[id].session) {
        users[id].session.disconnect();
    }
}

function addSessionCallbacks(id) {
    if (users[id] && users[id].session) {
        var session = users[id].session;
        session.on('connected', session_onConnected);
        session.on('disconnected', session_onDisconnected);
        session.on('error', session_onError);
        session.on('incomingCall', session_onIncoming);
        session.on('status', session_onStatus);
    }
}

function removeSessionCallbacks(id) {
    if (users[id] && users[id].session) {
        var session = users[id].session;
        session.off();
    }
}


//=============================================================
// Call Commands
//=============================================================

function callConnect() {
    var id = $(this).closest('.user').attr('id'), toList, mediatypes;
    $('.ui-tooltip').remove();
    if (users[id]) {
        if (users[id].session && users[id].session.getStatus() === 'connected') {
            $('#' + id + ' .callError').html('').hide();
            $('#' + id + ' .callButtons input').attr('disabled', 'disabled');
            if (users[id].isIncomingCall && users[id].call) {
                // Get user media, then accept incoming call
                $('#' + id + ' .callButtons .callReject').removeAttr('disabled');
                getMyUserMedia(id);
            } else {
                // Make outgoing call

                users[id].isIncomingCall = false;
                $('#' + id + ' .callStatus').html('');
                $('#' + id + ' .callButtons .callDisconnect').removeAttr('disabled');

                // Construct Call parameters                
                mediatypes = 'audio,video';

                // Create Call
                users[id].call = users[id].session.createCall($('#callee').val(), mediatypes); //TODO allow audio call option

                // STUB ONLY: Add a Session ID
                users[id].call.sid = users[id].session.sid;

                // Set Call callbacks
                addCallCallbacks(id);

                // Get user media, then connect
                getMyUserMedia(id);
            }
        } else {
            alert('Your Session does not appear to be connected. Cannot make a Call.');
        }
    }
}

function callDisconnect() {
    var id = $(this).closest('.user').attr('id');
    $('.ui-tooltip').remove();
    if (users[id]) {
        if (users[id].call) {
            users[id].call.disconnect();
        } else {
            alert('Tried to disconnect Call, but no Call was found.');
        }
    }
}

function callReject() {
    var id = $(this).closest('.user').attr('id');
    $('.ui-tooltip').remove();
    if (users[id]) {
        if (users[id].call) {
            users[id].call.reject();
            removeCallCallbacks(id);
            users[id].call = false;
            $('#' + id + ' .callStatus').html('You have rejected the call');
            $('#' + id + ' .callButtons input').attr('disabled', 'disabled').filter('.callConnect').removeAttr('disabled');
        } else {
            alert('Tried to reject Call, but no Call was found.');
        }
    }
}

function addCallCallbacks(id) {
    if (users[id] && users[id].call) {
        var call = users[id].call;
        call.on('connecting', call_onConnecting);
        call.on('connected', call_onConnected);
        call.on('stream:add', call_onAddStream);
        call.on('disconnected', call_onDisconnected);
        call.on('rejected', call_onRejected);
        call.on('error', call_onError);
    }
}

function removeCallCallbacks(id) {
    if (users[id] && users[id].call) {
        var call = users[id].call;
        call.off();
    }
}


//=============================================================
// Adding Local Stream
//=============================================================

function getMyUserMedia(id, forceNew) {
    var audio = true, video = true, m, mediaStreamConstraints;
    currentId = id;
    console.log('getUserMedia()');
    if (users[id].call) {
        $('#' + id + ' .getmedia').show();
    }
    if (!navigator.getUserMedia) {
        alert('Your browser does not suppoert getUserMedia, so we cannot continue with making the call.');
        onUserMediaError();
        return;
    }

    m = users[id].call.mediaTypes; //TODO: warning, mediaTypes is not in Orca API! need some way to retrieve mediatypes safely.
    if (typeof m === 'string') {
        if (m.indexOf('video') < 0) {
            video = false;
        }
        if (m.indexOf('audio') < 0) {
            audio = false;
        }
    }
    if (!requestMediaPerCall && !forceNew && users[id].localStream && users[id].localStream.readyState !== 2 && (audio === hasUserAudio) && (video === hasUserVideo)) {
        onUserMediaSuccess(users[id].localStream);
        return;
    }

    if (users[id].localStream) {
        users[id].localStream.stop();
    }

    hasUserAudio = audio;
    hasUserVideo = video;
    try {
        mediaStreamConstraints = {video: video, audio: audio};
        navigator.getUserMedia(mediaStreamConstraints, onUserMediaSuccess, onUserMediaError);
    } catch (e) {
        onUserMediaError();
    }
}

function onUserMediaSuccess(stream) {
    var id = currentId, url;
    console.log('onUserMediaSuccess()');
    users[id].localStream = stream;
    url = window.nativeURL.createObjectURL(stream);
    $('#' + id + ' .localVideo').attr('src', url);
    if (users[id].call) {
        $('#' + id + ' .getmedia').hide();
        $('#' + id + ' .callButtons input').attr('disabled', 'disabled').filter('.callDisconnect').removeAttr('disabled');
        users[id].call.addStream(stream);
        users[id].call.connect();
    }
}

function onUserMediaError() {
    var id = currentId;
    console.log('onUserMediaError()');
    if (users[id].call && (!users[id].localStream || users[id].localStream.readyState === 2)) {
        if (confirm('Failed to get camera/microphone! Try again?')) {
            getUserMedia(id);
            return;
        }
        if (users[id].isIncomingCall && users[id].call) {
            users[id].call.reject();
        }
        removeCallCallbacks(id);
        users[id].call = false;
        hasUserAudio = false;
        hasUserVideo = false;
        $('#' + id + ' .getmedia').hide();
        resetCallUI(id);
    }
}


//=============================================================
// UI
//=============================================================

function initUI() {

    // Add UI event handlers
    $('.sessionConnect,.sessionDisconnect,.callDisconnect,.callReject,.helpButton').tooltip({
        items: '.sessionConnect,.sessionDisconnect,.callDisconnect,.callReject,.helpButton',
        content: function () {
            return '<pre>' + $(this).next().html() + '</pre>';
        }
    });
    $('.callConnect').tooltip({
        items: '.callConnect',
        content: function () {
            var id, h;
            id = $(this).closest('.user').attr('id');
            h = '';
            if (users[id]) {
                if (users[id].isIncomingCall) {
                    h = $(this).next().next().html();
                } else {
                    h = $(this).next().html();
                }
            }
            return '<pre>' + h + '<pre>';
        }
    });
    $('.sessionConnect').click(sessionConnect);
    $('.sessionDisconnect').click(sessionDisconnect);
    $('.callConnect').click(callConnect);
    $('.callDisconnect').click(callDisconnect);
    $('.callReject').click(callReject);

    // Initial UI state
    $('.getmedia').hide();
    $('input[name="call_video"]').attr('checked', 'checked');
    $('.error').click(function () { $(this).hide(); }).hide();
    $('.sessionStatus').html('disconnected');
    resetSessionUI();
    resetCallUI(null, true);

    // Browser feature test
    var incompatibles = [];
    window.nativeURL = window.webkitURL || window.URL;
    if (!window.nativeURL) {
        incompatibles.push('createObjectURL');
    }
    navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia ||
            navigator.mozGetUserMedia || navigator.msGetUserMedia;
    if (!navigator.getUserMedia) {
        incompatibles.push('getUserMedia');
    }
    if (incompatibles.length) {
        alert('Your browsing is missing the following features needed for this demo: ' +
                incompatibles.join(', ') +
                '. Please use a WebRTC-compatible browser such as the latest Google Chrome.');
    }
	
	$('#reflectorIP').val(window.location.host);
}

function resetSessionUI(id) {
    var i;
    if (!id) {
        for (i in users) {
            if (users.hasOwnProperty(i)) {
                resetSessionUI(users[i].pageId);
            }
        }
        return;
    }
    $('#' + id + ' .sessionConnect').removeAttr('disabled');
    $('#' + id + ' .sessionDisconnect').attr('disabled', 'disabled');
}

function resetCallUI(id, disable) {
    var i;
    if (!id) {
        for (i in users) {
            if (users.hasOwnProperty(i)) {
                resetCallUI(i, disable);
            }
        }
        return;
    }
    $('#' + id + ' .callParticipants').empty();
    $('#' + id + ' .callButtons input').attr('disabled', 'disabled');
    $('#' + id + ' .remoteVideo').attr('src', '');
    if (requestMediaPerCall) {
        $('#' + id + ' .localVideo').attr('src', '');
    }
    if (disable) {
        $('#' + id + ' .callStatus').html('');
        $('#' + id + ' .call').addClass('disabled');
    } else {
        $('#' + id + ' .callButtons .callConnect').removeAttr('disabled');
    }	
}


//=============================================================
// Run on Page
//=============================================================

$(document).ready(function () {
    initUI();
});
