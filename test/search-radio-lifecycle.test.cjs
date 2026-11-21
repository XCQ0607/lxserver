const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/music/app.js', 'utf8');
const section = (a, b) => {
    const from = source.indexOf(a), to = source.indexOf(b, from);
    assert.ok(from >= 0 && to > from, a);
    return source.slice(from, to);
};
const fn = a => section(a, '\n}') + '\n}';
const song = id => ({ id, songmid: id, source: 'tx', name: id, singer: 'Band' });
function player(args = {}) {
    const c = vm.createContext({ console: { log(){}, warn(){}, error(){} }, window: {}, performance, setTimeout, clearTimeout,
        URLSearchParams, AbortController, Event, API_BASE: '/api/music', settings: {}, loadingRequestCounter: 0, currentIndex: 0, currentPlaylist: [song('seed'),song('queued')],
        currentPlayingScope: 'network', playMode: 'order', searchRadioArmed: true, searchRadioSongs: new WeakSet(), searchRadioCache: null, preSelectedNextIndex: null,
        localStorage: { getItem(){ return null; }, setItem(){}, clear(){} }, sessionStorage: { getItem(){return null;}, removeItem(){}, clear(){} },
        getUserAuthHeaders: () => ({}), showInfo(){}, updated: null, played: null,
        updatePlaylist(items, i){c.updated = items[i].id;}, playSong(item){ c.played = item.id; }, ...args });
    vm.runInContext([section('function playNext() {','\nfunction playPrev('),fn('function cleanSongData('),fn('function getNextIndex() {')].join('\n'), c);
    return c;
}

for (const event of ['logout', 'sync logout', 'output removed']) test(event + ' neutralizes a recommendation arriving after audio stops', async () => {
    let completeLookup, finishCleanup, deviceChange, paused = false, cleaning = false, devices = [{kind:'audiooutput'}];
    const c = player({ userToken:null, syncManager:null, shouldAutoRecoverPlayback:true,
        audio: {pause(){ paused=true; }}, document:{getElementById(){return null;}},
        window:{ListStore:{remove(){cleaning=true;return new Promise(resolve=>{finishCleanup=resolve;});}}, dispatchEvent(){}, location:{replace(){}, reload(){}}},
        navigator:{mediaDevices:{enumerateDevices:async()=>devices, addEventListener:(_, cb)=>{deviceChange=cb;}}},
        fetch: async url => url.includes('/similar?') ? new Promise(resolve=>{completeLookup=()=>resolve({ok:true,json:async()=>({list:[song('late')],strategy:'radio'})});}) : {ok:true},
    });
    const next=c.continueWithSimilarSongs();
    let logout;
    if(event==='output removed') {
        vm.runInContext(section('let lastAudioDeviceChangeTime =','\ntry {\n    setupAudioDeviceChangeListener();'),c);
        await c.setupAudioDeviceChangeListener(); devices=[]; await deviceChange();
    } else {
        vm.runInContext(fn(event==='logout' ? 'async function handleLogout()' : 'async function handleSyncLogout('),c);
        logout=event==='logout'?c.handleLogout():c.handleSyncLogout(true);
        for(let i=0;i<15&&!cleaning;i++) await Promise.resolve();
        assert.equal(cleaning,true);
    }
    assert.equal(paused,true); completeLookup(); await next;
    assert.equal(c.updated,null); assert.equal(c.played,null);
    if(finishCleanup){ finishCleanup(); await logout; }
});

test('an explicit play-next survives serializing the queue', async () => {
    const c=player(); c.keepAsNextSong(c.currentPlaylist[1]);
    const restored=player({currentPlaylist:JSON.parse(JSON.stringify(c.currentPlaylist))});
    assert.equal(restored.isSearchRadioDue(),false);
});

test('switching to the default list disarms radio; keeping the search queue does not', () => {
    for(const switchSetting of [true,false]) {
        const c=player({settings:{switchPlaylistOnSearchPlay:switchSetting},currentListData:{defaultList:[song('default')]},document:{getElementById:()=>null}});
        c.playbackSong=c.currentPlaylist[0];
        const fallback=section('const isSongListOrLeaderboard =', '\n            }\n        } catch (playError)');
        vm.runInContext(fallback,c);
        assert.equal(c.currentPlayingScope,switchSetting?'network':'local_list');
        assert.equal(c.searchRadioArmed,switchSetting);
    }
});

test('automatic skip after failure advances the queue without a metadata request', () => {
    let callback; const c=player({setTimeout:f=>{callback=f;return 1;}, RecoveryToast:{error(){}}, error:new Error('unavailable'), setPlayerStatus(){}, fetch:()=>assert.fail('lookup from failed song')});
    vm.runInContext(section("} else if (currentStep === 'skip_next') {", '\n    }\n}').split("'skip_next') {")[1],c);
    callback();
    assert.equal(c.played,'queued'); assert.equal(c.updated,null);
});

test('a saved queue restores its own radio flag; the separate flag is read only for a legacy snapshot', async () => {
    for(const [saved, legacy, scope, expected] of [[false,'1','network',false],[true,'0','network',true],[true,'1','local_list',false],[undefined,'1','network',true],[undefined,'0','network',false]]) {
        const store=new Map([['lx_search_radio_armed',legacy]]);
        const c=player({ currentPlayingSong:song('old'), currentPlayingScope:scope, searchRadioArmed:saved===true,
            audio:{currentTime:1},currentQuality:'flac',settings:{autoResume:true},renderQueue(){},updatePlayModeUI(){},updatePlayerInfo(){},updateMediaSessionMetadata(){},setTimeout(){},
            localStorage:{setItem:(k,v)=>store.set(k,v),getItem:k=>store.get(k)} });
        vm.runInContext(fn('function savePlaybackState()')+'\n'+fn('async function restorePlaybackState()'),c);
        assert.equal(c.savePlaybackState(),true);
        const snapshot=JSON.parse(store.get('lx_playback_state'));
        assert.equal(snapshot.searchRadioArmed,saved===true);
        if(saved===undefined){delete snapshot.searchRadioArmed;store.set('lx_playback_state',JSON.stringify(snapshot));}
        c.setSearchRadioArmed(!expected);
        assert.equal(store.get('lx_search_radio_armed'),legacy);
        await c.restorePlaybackState();
        assert.equal(c.searchRadioArmed,expected);
    }
});
