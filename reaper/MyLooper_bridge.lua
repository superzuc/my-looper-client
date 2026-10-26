--[[
  MyLooper bridge
  ---------------
  Links the iPad web UI (served by REAPER's web interface) with the MyLooper JSFX.

    iPad  --HTTP-->  REAPER web server  --ExtState "MyLooper/cmd"-->  this script
    this script  --gmem "MyLooper"-->  MyLooper.jsfx (one per track)
    MyLooper.jsfx  --gmem-->  this script  --ExtState "MyLooper/state" (JSON)-->  iPad

  - Every track that contains a MyLooper JSFX becomes a "looper"; IDs 1..16 follow
    track order (this is also the swipe order on the iPad).
  - Run it once per session (Actions > Load ReaScript), or add it to __startup.lua.
  - Memories: 8 slots saved in <project folder>/MyLooper/mem<N>/ as one float WAV per
    section + mem.txt (tempo, lengths, volume/pan/mute). Audio goes through gmem
    (XF area) in chunks, see the header of MyLooper.jsfx.
]]

local NS            = "MyLooper"   -- gmem namespace (must match the JSFX)
local EXT           = "MyLooper"   -- ExtState section (must match the web app)
local MAX_LOOPERS   = 16
local AUTO_TRANSPORT = true        -- start REAPER playback when a rec/play command arrives
local SCAN_EVERY    = 1.0          -- seconds between track scans
local PROTO         = 12            -- must match MyLooper.jsfx (gmem +11) and the web app

-- Drum machine: the "Drum" button on the iPad mutes / unmutes these tracks at the end of
-- the bar, so the machine keeps running on the MIDI clock and comes back perfectly in sync.
local DRUM_NAME     = "drum"       -- any track whose name contains this (case insensitive)
local DRUM_TRACKS   = { 4, 5 }     -- fallback if no track name matches: track numbers (1-based)
local DRUM_GRACE    = 0.15         -- as in the JSFX: a press just after the bar line still counts
-- Pattern changes go to the drum machine as SysEx on its MIDI output (IK UNO Drum:
-- F0 00 21 1A 02 02 35 00 <pattern> F7, the same port REAPER already sends the clock to)
local UNO_NAME      = "uno"        -- MIDI output whose name contains this (case insensitive)
local GATE_FX       = { "JS:MyLooper/MyLooper_gate.jsfx", "JS:MyLooper/MyLooper_gate", "MyLooper Gate" }

reaper.gmem_attach(NS)

local loopers   = {}
local lastScan  = -1
local lastSess  = ""
local lastSeq   = 0
local tick      = 0
local hbSeen    = {}   -- id -> {hb, time}
local drums     = { tracks = {}, mute = 0, want = -1, target = nil }

---------------------------------------------------------------- helpers
-- No backslashes ever reach the JSON (REAPER's web API escapes them in ExtState
-- values), so quotes become apostrophes and control chars become spaces.
local function jsonStr(s)
  s = s:gsub('"', "'"):gsub('\\', '/'):gsub('%c', ' ')
  return '"' .. s .. '"'
end

local function num(v)
  if v ~= v or v == math.huge or v == -math.huge then return "0" end
  if v == math.floor(v) then return string.format("%d", math.floor(v)) end
  return string.format("%.4f", v)
end

local function trackColor(tr)
  local c = reaper.GetTrackColor(tr)
  if c == 0 then return "" end
  local r, g, b = reaper.ColorFromNative(c)
  return string.format("#%02x%02x%02x", r, g, b)
end

---------------------------------------------------------------- scanning
local function scan()
  local list = {}
  for t = 0, reaper.CountTracks(0) - 1 do
    local tr = reaper.GetTrack(0, t)
    for f = 0, reaper.TrackFX_GetCount(tr) - 1 do
      local _, fxname = reaper.TrackFX_GetFXName(tr, f, "")
      local low = fxname:lower()
      local isGate = low:find("mylooper gate", 1, true) or low:find("mylooper_gate", 1, true)
      if fxname:find("MyLooper", 1, true) and not isGate and #list < MAX_LOOPERS then
        list[#list + 1] = { track = tr, fx = f }
        break -- one looper per track
      end
    end
  end

  for i, l in ipairs(list) do
    l.id = i
    local cur = reaper.TrackFX_GetParam(l.track, l.fx, 0) -- slider1 = Looper ID
    if math.floor(cur + 0.5) ~= i then
      reaper.TrackFX_SetParam(l.track, l.fx, 0, i)
    end
    local _, name = reaper.GetSetMediaTrackInfo_String(l.track, "P_NAME", "", false)
    if name == "" then
      name = "Traccia " .. math.floor(reaper.GetMediaTrackInfo_Value(l.track, "IP_TRACKNUMBER"))
    end
    l.name  = name
    l.color = trackColor(l.track)
  end
  loopers = list
end

---------------------------------------------------------------- commands
local function push(id, code, arg)
  local gb = id * 1024
  local w  = reaper.gmem_read(gb + 512)
  local k  = (math.floor(w) % 64) * 4
  reaper.gmem_write(gb + 520 + k, code)
  reaper.gmem_write(gb + 521 + k, arg)
  reaper.gmem_write(gb + 512, w + 1)   -- publish last
end

local function isPlaying()
  return (reaper.GetPlayState() & 1) == 1
end

---------------------------------------------------------------- drum machine
-- The machine follows REAPER's MIDI clock, so it can't be "paused" on its own without
-- losing the sync: instead its tracks are muted at the end of the bar. It keeps turning,
-- and when it comes back it is exactly where the loops expect it.
local function scanDrums()
  local list = {}
  for t = 0, reaper.CountTracks(0) - 1 do
    local tr = reaper.GetTrack(0, t)
    local _, name = reaper.GetSetMediaTrackInfo_String(tr, "P_NAME", "", false)
    if name ~= "" and name:lower():find(DRUM_NAME, 1, true) then list[#list + 1] = tr end
  end
  if #list == 0 then
    for _, n in ipairs(DRUM_TRACKS) do
      local tr = reaper.GetTrack(0, n - 1)
      if tr then list[#list + 1] = tr end
    end
  end
  drums.tracks = list
  -- follow the real state, so muting from REAPER keeps the iPad in sync
  if list[1] then
    drums.mute = reaper.GetMediaTrackInfo_Value(list[1], "B_MUTE") >= 0.5 and 1 or 0
  end
end

local function setDrums(v)
  for _, tr in ipairs(drums.tracks) do
    reaper.SetMediaTrackInfo_Value(tr, "B_MUTE", v)
  end
  drums.mute   = v >= 0.5 and 1 or 0
  drums.want   = -1
  drums.target = nil
end

-- current measure index + how far we are into it (seconds)
local function measureAt(pos)
  local _, measures = reaper.TimeMap2_timeToBeats(0, pos)
  local mstart = reaper.TimeMap2_beatsToTime(0, 0, measures)
  return measures, pos - mstart
end

local function toggleDrums()
  if #drums.tracks == 0 then return end
  if drums.want >= 0 then drums.want = -1; drums.target = nil; return end  -- a second press cancels
  local want = drums.mute == 1 and 0 or 1
  if not isPlaying() then setDrums(want) return end
  local m, into = measureAt(reaper.GetPlayPosition())
  if into < DRUM_GRACE then setDrums(want) return end                     -- pressed just after the bar line
  drums.want   = want
  drums.target = m + 1
end

local function runDrums()
  if drums.want < 0 then return end
  if not isPlaying() then setDrums(drums.want) return end
  local m = measureAt(reaper.GetPlayPosition())
  if m >= (drums.target or m) then setDrums(drums.want) end
end

---------------------------------------------------------------- drum machine: pattern
-- Settings from the iPad, kept by REAPER between sessions:
--   uno_ofs  0 = byte sent = pattern number, 1 = pattern number - 1
--   uno_lead how early the change is sent, in eighths (0 = on the bar line): useful if
--            the machine waits for the end of its pattern before switching
local uno = { dev = -1, name = "", last = 0, sent = 0, err = "" }

local function unoSetting(key, def)
  local v = tonumber(reaper.GetExtState(EXT, key))
  return v or def
end

local function scanUno()
  uno.dev, uno.name = -1, ""
  if not reaper.GetNumMIDIOutputs then return end
  for i = 0, reaper.GetNumMIDIOutputs() - 1 do
    local ok, name = reaper.GetMIDIOutputName(i, "")
    if ok and name and name:lower():find(UNO_NAME, 1, true) then
      uno.dev, uno.name = i, name
      return
    end
  end
end

local function sendPattern(n)
  n = math.floor(n or 0)
  if n < 1 or n > 100 then return end
  if not reaper.SendMIDIMessageToHardware then uno.err = "REAPER troppo vecchio (manca SendMIDIMessageToHardware)" return end
  if uno.dev < 0 then scanUno() end
  if uno.dev < 0 then uno.err = "UNO Drum non trovata tra le uscite MIDI" return end
  local b = n - unoSetting("uno_ofs", 0)
  b = math.max(0, math.min(127, b))
  reaper.SendMIDIMessageToHardware(uno.dev, string.char(0xF0, 0x00, 0x21, 0x1A, 0x02, 0x02, 0x35, 0x00, b, 0xF7))
  uno.last, uno.sent, uno.err = n, uno.sent + 1, ""
end

---------------------------------------------------------------- drum machine: stacchi
-- A stacco on the drum needs to be sample accurate, so it is done by MyLooper_gate.jsfx
-- on the drum tracks (the bridge muting the tracks would be ~30 ms late). The gate reads
-- up to 4 windows from gmem 66..73 and beats 64.
local GATE = 64
local gateSeen = { hb = -1, time = -100 }

local function gateAlive(now)
  local hb = reaper.gmem_read(GATE)
  if hb ~= gateSeen.hb then gateSeen.hb, gateSeen.time = hb, now end
  return now - gateSeen.time < 1.0
end

local function hasGate(tr)
  for f = 0, reaper.TrackFX_GetCount(tr) - 1 do
    local _, n = reaper.TrackFX_GetFXName(tr, f, "")
    n = n:lower()
    if n:find("mylooper gate", 1, true) or n:find("mylooper_gate", 1, true) then return true end
  end
  return false
end

local function ensureGate()
  if not reaper.TrackFX_AddByName then return end
  for _, tr in ipairs(drums.tracks) do
    if not hasGate(tr) then
      for _, name in ipairs(GATE_FX) do
        if reaper.TrackFX_AddByName(tr, name, false, -1) >= 0 then break end   -- -1 = add a new one
      end
    end
  end
end

local function gateWindow(a, b)
  local now = 0
  local _, _, _, fb = reaper.TimeMap2_timeToBeats(0, reaper.GetPlayPosition())
  now = fb or 0
  local best, bestEnd = 0, math.huge
  for k = 0, 3 do
    local e = reaper.gmem_read(GATE + 3 + 2 * k)
    if e <= now then best = k break end                     -- free
    if e < bestEnd then best, bestEnd = k, e end            -- all busy: the one ending first
  end
  reaper.gmem_write(GATE + 3 + 2 * best, 0)                 -- end last: never half written
  reaper.gmem_write(GATE + 2 + 2 * best, a)
  reaper.gmem_write(GATE + 3 + 2 * best, b)
end

local function gateClear()
  for k = 0, 3 do reaper.gmem_write(GATE + 3 + 2 * k, 0) end
end

---------------------------------------------------------------- drum machine: resync
-- If REAPER hiccups (an audio dropout), the machine can lose MIDI clock ticks and end up
-- off the bar. A resync sends Stop + Start to it half a clock tick before a bar line
-- (MyLooper_gate.jsfx does it, sample accurate, through the MIDI output of the first drum
-- track), so it restarts its pattern exactly on the 1. On a multiple of the pattern length,
-- counted from the start of the project. Automatic after every dropout REAPER reports,
-- or by hand (long press on Drum).
--   drum_sync_auto  1 = after a dropout (default), 0 = only by hand
--   drum_patlen     length of the machine's pattern in bars (1, 2, 4, 8)
local sync = { beat = 0, bar = 0, seq = 0, n = 0, miss = 0, xruns = 0, lastX = nil, prepared = {} }

local function syncSetting(key, def)
  local v = tonumber(reaper.GetExtState(EXT, key))
  return v or def
end

-- gate on the drum tracks + MIDI output of the first one to the machine (only if it had none)
local function prepareDrumSync(force)
  local tr = drums.tracks[1]
  if not tr then return end
  local key = tostring(tr)
  if sync.prepared[key] and not force then return end
  sync.prepared[key] = true
  ensureGate()
  if uno.dev < 0 then scanUno() end
  if uno.dev >= 0 and reaper.GetMediaTrackInfo_Value(tr, "I_MIDIHWOUT") < 0 then
    reaper.SetMediaTrackInfo_Value(tr, "I_MIDIHWOUT", uno.dev * 32)   -- device, all channels
  end
end

local function midiOutOk()
  local tr = drums.tracks[1]
  return tr and reaper.GetMediaTrackInfo_Value(tr, "I_MIDIHWOUT") >= 0
end

local function requestResync()
  if #drums.tracks == 0 or not isPlaying() then return end
  prepareDrumSync(true)
  local len = math.max(1, math.floor(syncSetting("drum_patlen", 1)))
  local pos = reaper.GetPlayPosition()
  local _, measures = reaper.TimeMap2_timeToBeats(0, pos)
  local _, _, cml, nowFull = reaper.TimeMap2_timeToBeats(0, pos)
  local barLen = (cml and cml > 0) and cml or 4
  local m = measures + 1
  for _ = 1, 64 do
    local t = reaper.TimeMap2_beatsToTime(0, 0, m)
    local _, _, _, fb = reaper.TimeMap2_timeToBeats(0, t)
    if m % len == 0 and fb - nowFull >= barLen * 0.25 then
      sync.seq = (math.floor(reaper.time_precise() * 1000) % 1000000) + 1
      sync.beat, sync.bar = fb, m + 1
      reaper.gmem_write(GATE + 10, 0)
      reaper.gmem_write(GATE + 11, sync.seq)
      reaper.gmem_write(GATE + 10, fb)      -- beat last: never half written
      return
    end
    m = m + 1
  end
end

local function runSync()
  -- a dropout reported by REAPER? (audio or media xrun)
  if reaper.GetUnderrunTime then
    local a, md = reaper.GetUnderrunTime()
    local key = tostring(a) .. ":" .. tostring(md)
    if sync.lastX and key ~= sync.lastX and isPlaying() then
      sync.xruns = sync.xruns + 1
      if syncSetting("drum_sync_auto", 1) == 1 and sync.beat == 0 and drums.mute == 0 then requestResync() end
    end
    sync.lastX = key
  end
  if sync.beat > 0 then
    local _, _, _, fb = reaper.TimeMap2_timeToBeats(0, reaper.GetPlayPosition())
    if not isPlaying() then
      sync.beat, sync.bar = 0, 0
      reaper.gmem_write(GATE + 10, 0)
    elseif (fb or 0) > sync.beat + 0.5 then
      if reaper.gmem_read(GATE + 12) == sync.seq then sync.n = sync.n + 1 else sync.miss = sync.miss + 1 end
      sync.beat, sync.bar = 0, 0
      reaper.gmem_write(GATE + 10, 0)
    end
  end
end

---------------------------------------------------------------- synth: sounds
-- The sounds of the synth (Splice INSTRUMENT / LABS) are REAPER presets of the plugin:
-- "Salva suono" on the iPad copies the current state of the plugin into REAPER's preset
-- file (the same format REAPER writes: hex of the state + 1 byte checksum = sum of the
-- bytes), with the instrument name read from the state itself. Changing sound is then
-- TrackFX_SetPreset: only that plugin changes, the looper on the same track is untouched.
-- Every sound gets a stable id (kept in Scripts/MyLooper/suoni.txt), used by the scaletta.
local SYNTH_TRACK   = "synth"      -- track whose name contains this (case insensitive)
local SYNTH_FX      = { "splice instrument", "labs" }   -- which plugin on it, in this order

local synth = { track = nil, fx = -1, fxname = "", file = "", list = {}, cur = "", msg = "",
                listAt = -100, ids = nil }

local B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local B64I = {}
for i = 1, 64 do B64I[B64:byte(i)] = i - 1 end
local function b64decode(s)
  local out, n, bits = {}, 0, 0
  for i = 1, #s do
    local v = B64I[s:byte(i)]
    if v then
      bits = bits * 64 + v
      n = n + 6
      if n >= 8 then
        n = n - 8
        local b = math.floor(bits / 2 ^ n) % 256
        out[#out + 1] = string.char(b)
        bits = bits % (2 ^ n)
      end
    end
  end
  return table.concat(out)
end

local function presetFileFor(fxname)
  -- "VST3i: Splice INSTRUMENT (Splice)" -> presets/vst3-Splice INSTRUMENT.ini
  local kind, rest = fxname:match("^(%w+)i?:%s*(.-)$")
  if not kind then return "" end
  kind = kind:lower():gsub("i$", "")
  rest = rest:gsub("%s*%b()%s*$", "")
  return reaper.GetResourcePath() .. "/presets/" .. kind .. "-" .. rest .. ".ini"
end

local function scanSynth()
  synth.track, synth.fx = nil, -1
  for t = 0, reaper.CountTracks(0) - 1 do
    local tr = reaper.GetTrack(0, t)
    local _, name = reaper.GetSetMediaTrackInfo_String(tr, "P_NAME", "", false)
    if name:lower():find(SYNTH_TRACK, 1, true) then
      for _, want in ipairs(SYNTH_FX) do
        for f = 0, reaper.TrackFX_GetCount(tr) - 1 do
          local _, fxn = reaper.TrackFX_GetFXName(tr, f, "")
          if fxn:lower():find(want, 1, true) then
            synth.track, synth.fx, synth.fxname = tr, f, fxn
            synth.file = presetFileFor(fxn)
            return
          end
        end
      end
    end
  end
end

-- the preset file: { general = {lines}, presets = { {name, data, len} } }
local function readPresets(path)
  local pf = { general = {}, presets = {} }
  local f = io.open(path, "rb")
  if not f then return pf end
  local cur = nil
  for line in f:lines() do
    line = line:gsub("\r$", "")
    local sec = line:match("^%[(.-)%]$")
    if sec then
      if sec:match("^Preset%d+$") then cur = {}; pf.presets[#pf.presets + 1] = cur else cur = nil end
    elseif line ~= "" then
      local k, v = line:match("^([^=]+)=(.*)$")
      if k then
        if cur then cur[k] = v
        elseif k ~= "NbPresets" then pf.general[#pf.general + 1] = line end
      end
    end
  end
  f:close()
  return pf
end

local function writePresets(path, pf)
  local out = { "[General]" }
  for _, l in ipairs(pf.general) do out[#out + 1] = l end
  out[#out + 1] = "NbPresets=" .. #pf.presets
  out[#out + 1] = ""
  for i, p in ipairs(pf.presets) do
    out[#out + 1] = "[Preset" .. (i - 1) .. "]"
    for k, v in pairs(p) do
      if k ~= "Data" and k ~= "Len" and k ~= "Name" then out[#out + 1] = k .. "=" .. v end
    end
    out[#out + 1] = "Data=" .. (p.Data or "")
    out[#out + 1] = "Len=" .. (p.Len or "0")
    out[#out + 1] = "Name=" .. (p.Name or "")
    out[#out + 1] = ""
  end
  reaper.RecursiveCreateDirectory(reaper.GetResourcePath() .. "/presets", 0)
  local f = io.open(path, "wb")
  if not f then return false end
  f:write(table.concat(out, "\r\n"))
  f:close()
  return true
end

-- stable ids for the scaletta: id|name, one per line
local function idsPath() return reaper.GetResourcePath() .. "/Scripts/MyLooper/suoni.txt" end
local function loadIds()
  synth.ids = { byName = {}, byId = {}, next = 1 }
  local f = io.open(idsPath(), "r")
  if not f then return end
  for line in f:lines() do
    local id, name = line:match("^(%d+)|(.*)$")
    if id then
      id = tonumber(id)
      synth.ids.byName[name], synth.ids.byId[id] = id, name
      synth.ids.next = math.max(synth.ids.next, id + 1)
    end
  end
  f:close()
end
local function idFor(name)
  if not synth.ids then loadIds() end
  local id = synth.ids.byName[name]
  if id then return id end
  id = synth.ids.next
  synth.ids.next = id + 1
  synth.ids.byName[name], synth.ids.byId[id] = id, name
  local f = io.open(idsPath(), "a")
  if f then f:write(id .. "|" .. name .. "\n"); f:close() end
  return id
end

local function refreshSynthList(now)
  synth.listAt = now or 0
  synth.list = {}
  if synth.file == "" then return end
  for _, p in ipairs(readPresets(synth.file).presets) do
    if p.Name and p.Name ~= "" then synth.list[#synth.list + 1] = { id = idFor(p.Name), name = p.Name } end
  end
end

-- the state of the plugin, exactly as it is in the project (= the body of a preset)
local function synthState()
  if not synth.track then return nil end
  local ok, chunk = reaper.GetTrackStateChunk(synth.track, "", false)
  if not ok then return nil end
  local idx, inChain, lines, grab = -1, false, {}, false
  for line in chunk:gmatch("[^\r\n]+") do
    local t = line:match("^%s*(.-)%s*$")
    if grab then
      if t == ">" then break end
      lines[#lines + 1] = b64decode(t)       -- every line is whole base64 quads
    elseif t:match("^<FXCHAIN$") or t:match("^<FXCHAIN%s") then inChain = true
    elseif t:match("^<FXCHAIN_REC") then inChain = false
    elseif inChain and (t:match("^<VST ") or t:match("^<JS ") or t:match("^<AU ") or t:match("^<CLAP ")
           or t:match("^<DX ") or t:match("^<LV2 ") or t:match("^<VIDEO_EFFECT")) then
      idx = idx + 1
      if idx == synth.fx then grab = true end
    end
  end
  if #lines == 0 then return nil end
  return table.concat(lines)
end

local function soundName(state)
  local family, name = state:match('<META family="([^"]*)" name="([^"]*)"')
  if name and name ~= "" then
    return (family and family ~= "") and (name .. " (" .. family .. ")") or name
  end
  return "Suono " .. os.date("%d/%m %H.%M")
end

local function saveSound()
  scanSynth()
  if not synth.track then synth.msg = "Non trovo la traccia synth con Splice INSTRUMENT" return end
  local state = synthState()
  if not state then synth.msg = "Non riesco a leggere lo stato del synth" return end
  local name = soundName(state):gsub("[\r\n=%[%]]", " ")
  local sum = 0
  for i = 1, #state do sum = sum + state:byte(i) end
  local hex = (state .. string.char(sum % 256)):gsub(".", function(c) return string.format("%02X", c:byte()) end)
  local pf = readPresets(synth.file)
  local found = nil
  for _, p in ipairs(pf.presets) do if p.Name == name then found = p end end
  if not found then found = {}; pf.presets[#pf.presets + 1] = found end
  found.Data, found.Len, found.Name = hex, tostring(#state), name
  if not writePresets(synth.file, pf) then synth.msg = "Non riesco a scrivere il file dei preset" return end
  idFor(name)
  refreshSynthList(reaper.time_precise())
  -- the sound is already the current one: selecting it tells us if REAPER sees the new preset
  reaper.TrackFX_SetPreset(synth.track, synth.fx, name)
  local _, cur = reaper.TrackFX_GetPreset(synth.track, synth.fx, "")
  synth.msg = (cur == name) and ("Salvato: " .. name)
    or ("Salvato: " .. name .. " (se non lo carica, riavvia REAPER una volta)")
end

local function loadSound(id)
  if not synth.track then scanSynth() end
  if not synth.track then return end
  if not synth.ids then loadIds() end
  local name = synth.ids.byId[id]
  if not name then synth.msg = "Suono " .. id .. " non trovato" return end
  local ok = reaper.TrackFX_SetPreset(synth.track, synth.fx, name)
  synth.msg = ok and "" or ("Non riesco a caricare " .. name)
end

local function deleteSound(id)
  if not synth.ids then loadIds() end
  local name = synth.ids.byId[id]
  if not name or synth.file == "" then return end
  local pf = readPresets(synth.file)
  for i = #pf.presets, 1, -1 do if pf.presets[i].Name == name then table.remove(pf.presets, i) end end
  writePresets(synth.file, pf)
  refreshSynthList(reaper.time_precise())
end

local function synthJson()
  local items = {}
  for _, s in ipairs(synth.list) do
    items[#items + 1] = string.format('{"id":%d,"name":%s}', s.id, jsonStr(s.name))
  end
  local cur = ""
  if synth.track and synth.fx >= 0 then
    local ok, p = reaper.TrackFX_GetPreset(synth.track, synth.fx, "")
    if ok then cur = p or "" end
  end
  return string.format('{"ok":%d,"fx":%s,"cur":%s,"msg":%s,"list":[%s]}',
    synth.track and 1 or 0, jsonStr((synth.fxname or ""):gsub("^%w+:%s*", "")), jsonStr(cur),
    jsonStr(synth.msg), table.concat(items, ","))
end

---------------------------------------------------------------- memories (save / load)
local XF        = 18432
local XF_DATA   = XF + 32
local CHUNK     = 16384      -- frames per transfer
local NSLOTS    = 8
local job       = nil        -- running / last job, shown on the iPad
local slots     = {}         -- slot info for the UI
local xseq      = 0

local function memBase()
  local p = reaper.GetProjectPath()
  return (p ~= "" and p or reaper.GetResourcePath()) .. "/MyLooper"
end
local function memDir(slot) return memBase() .. "/mem" .. slot end

local function fileExists(path)
  local f = io.open(path, "rb")
  if f then f:close() return true end
  return false
end

local function readMeta(slot)
  local f = io.open(memDir(slot) .. "/mem.txt", "r")
  if not f then return nil end
  local m = { loopers = {}, sections = {} }
  for line in f:lines() do
    local k, v = line:match("^(%w+)=(.*)$")
    if k then
      m[k] = v
    else
      local parts = {}
      for x in (line .. "|"):gmatch("(.-)|") do parts[#parts + 1] = x end
      if parts[1] == "L" then
        m.loopers[#m.loopers + 1] = { id = tonumber(parts[2]), name = parts[3],
          mode = tonumber(parts[4]), recBeats = tonumber(parts[5]) }
      elseif parts[1] == "S" then
        m.sections[#m.sections + 1] = { id = tonumber(parts[2]), s = tonumber(parts[3]),
          beats = tonumber(parts[4]), cbeats = tonumber(parts[5]), frames = tonumber(parts[6]),
          vol = tonumber(parts[7]), pan = tonumber(parts[8]), mute = tonumber(parts[9]),
          cue = tonumber(parts[10]) or 0, phase = tonumber(parts[11]) or 0 }
      end
    end
  end
  f:close()
  return m
end

local function refreshSlots()
  local list = {}
  for i = 1, NSLOTS do
    local m = readMeta(i)
    list[i] = m and { slot = i, saved = m.saved or "", n = #m.sections, tempo = m.tempo or "" }
                 or { slot = i }
  end
  slots = list
end

-- one transfer request to the JSFX of looper id; yields until the JSFX has done it
local function xreq(id, op, s, off, n)
  xseq = math.max(xseq, reaper.gmem_read(XF), reaper.gmem_read(XF + 1)) + 1
  reaper.gmem_write(XF + 2, op)
  reaper.gmem_write(XF + 3, id)
  reaper.gmem_write(XF + 4, s)
  reaper.gmem_write(XF + 5, off or 0)
  reaper.gmem_write(XF + 6, n or 0)
  reaper.gmem_write(XF, xseq)                 -- publish last
  local t0 = reaper.time_precise()
  while reaper.gmem_read(XF + 1) ~= xseq do
    if reaper.time_precise() - t0 > 3 then
      error("il looper " .. id .. " non risponde (FX bypassato o traccia non attiva?)", 0)
    end
    coroutine.yield()
  end
end

local function wavHeader(frames, sr)
  local bytes = frames * 8
  return "RIFF" .. string.pack("<I4", 36 + bytes) .. "WAVE" ..
         "fmt " .. string.pack("<I4I2I2I4I4I2I2", 16, 3, 2, sr, sr * 8, 8, 32) ..
         "data" .. string.pack("<I4", bytes)
end

local function clean(name) return (name:gsub("[|\r\n]", "/")) end

local function saveJob(slot)
  local dir = memDir(slot)
  reaper.RecursiveCreateDirectory(dir, 0)
  -- 1) what is there to save
  local todo, total = {}, 0
  for _, l in ipairs(loopers) do
    for s = 0, 7 do
      xreq(l.id, 4, s)
      if reaper.gmem_read(XF + 12) > 0 then
        local it = { l = l, s = s,
          beats = reaper.gmem_read(XF + 13), cbeats = reaper.gmem_read(XF + 14),
          frames = math.floor(reaper.gmem_read(XF + 15)),
          vol = reaper.gmem_read(XF + 16), pan = reaper.gmem_read(XF + 17),
          mute = reaper.gmem_read(XF + 18), sr = math.floor(reaper.gmem_read(XF + 19)),
          cue = reaper.gmem_read(XF + 22), phase = reaper.gmem_read(XF + 23) }
        todo[#todo + 1] = it
        total = total + it.frames
      end
    end
  end
  -- 2) remove the old files of this slot
  for id = 1, 16 do for s = 0, 7 do os.remove(dir .. "/L" .. id .. "_S" .. s .. ".wav") end end
  -- 3) audio
  local done, sr = 0, 48000
  for _, it in ipairs(todo) do
    sr = it.sr > 0 and it.sr or sr
    local f = assert(io.open(dir .. "/L" .. it.l.id .. "_S" .. it.s .. ".wav", "wb"))
    f:write(wavHeader(it.frames, sr))
    local off = 0
    while off < it.frames do
      local n = math.min(CHUNK, it.frames - off)
      xreq(it.l.id, 1, it.s, off, n)
      local buf = {}
      for i = 0, n - 1 do
        buf[#buf + 1] = string.pack("<ff", reaper.gmem_read(XF_DATA + 2 * i), reaper.gmem_read(XF_DATA + 2 * i + 1))
      end
      f:write(table.concat(buf))
      off = off + n
      done = done + n
      job.p = total > 0 and done / total or 1
      coroutine.yield()
    end
    f:close()
  end
  -- 4) description (written last: a slot without mem.txt is not a valid memory)
  local lines = {
    "saved=" .. os.date("%d/%m %H:%M"),
    "tempo=" .. string.format("%.4f", reaper.Master_GetTempo()),
    "srate=" .. sr,
  }
  for _, l in ipairs(loopers) do
    local gb = l.id * 1024
    lines[#lines + 1] = string.format("L|%d|%s|%d|%g", l.id, clean(l.name),
      math.floor(reaper.gmem_read(gb + 2)), reaper.gmem_read(gb + 1))
  end
  for _, it in ipairs(todo) do
    lines[#lines + 1] = string.format("S|%d|%d|%g|%g|%d|%g|%g|%d|%d|%.6f", it.l.id, it.s, it.beats,
      it.cbeats, it.frames, it.vol, it.pan, math.floor(it.mute), math.floor(it.cue), it.phase or 0)
  end
  local f = assert(io.open(dir .. "/mem.txt", "w"))
  f:write(table.concat(lines, "\n"), "\n")
  f:close()
  job.msg = #todo .. " sezioni salvate"
end

local function loadJob(slot)
  local m = readMeta(slot)
  if not m then error("memoria " .. slot .. " vuota", 0) end
  local dir = memDir(slot)
  -- same tempo as when it was saved, otherwise the loops would not fit
  local tempo = tonumber(m.tempo)
  local note = ""
  if tempo and math.abs(tempo - reaper.Master_GetTempo()) > 0.01 then
    reaper.SetCurrentBPM(0, tempo, true)
    note = " (tempo riportato a " .. string.format("%g", tempo) .. " BPM)"
  end
  -- saved looper -> current looper: same track name first, otherwise same position
  local map, used = {}, {}
  for _, sl in ipairs(m.loopers) do
    for _, l in ipairs(loopers) do
      if not used[l.id] and l.name == sl.name then map[sl.id] = l; used[l.id] = true; break end
    end
  end
  for _, sl in ipairs(m.loopers) do
    if not map[sl.id] then
      for _, l in ipairs(loopers) do
        if not used[l.id] and l.id == sl.id then map[sl.id] = l; used[l.id] = true; break end
      end
    end
  end
  -- total work
  local total, done = 0, 0
  for _, sec in ipairs(m.sections) do if map[sec.id] then total = total + sec.frames end end
  -- clear the target loopers and restore their settings
  for _, sl in ipairs(m.loopers) do
    local l = map[sl.id]
    if l then
      push(l.id, 8, 0)
      if sl.mode then push(l.id, 5, sl.mode) end
      if sl.recBeats and sl.recBeats > 0 then push(l.id, 17, math.floor(sl.recBeats * 2 + 0.5)) end
    end
  end
  coroutine.yield(); coroutine.yield()
  local loaded = 0
  for _, sec in ipairs(m.sections) do
    local l = map[sec.id]
    if l then
      local f = io.open(dir .. "/L" .. sec.id .. "_S" .. sec.s .. ".wav", "rb")
      if f then
        local data = f:read("a")
        f:close()
        local dpos = data:find("data", 13, true)
        if dpos then
          local bytes = string.unpack("<I4", data, dpos + 4)
          local frames = math.min(math.floor(bytes / 8), sec.frames or bytes)
          local pos = dpos + 8
          xreq(l.id, 5, sec.s)
          local off = 0
          while off < frames do
            local n = math.min(CHUNK, frames - off)
            for i = 0, n - 1 do
              local a, b
              a, b, pos = string.unpack("<ff", data, pos)
              reaper.gmem_write(XF_DATA + 2 * i, a)
              reaper.gmem_write(XF_DATA + 2 * i + 1, b)
            end
            xreq(l.id, 2, sec.s, off, n)
            off = off + n
            done = done + n
            job.p = total > 0 and done / total or 1
            coroutine.yield()
          end
          reaper.gmem_write(XF + 7, sec.beats)
          reaper.gmem_write(XF + 8, sec.cbeats)
          reaper.gmem_write(XF + 9, sec.vol or 1)
          reaper.gmem_write(XF + 10, sec.pan or 0)
          reaper.gmem_write(XF + 11, sec.mute or 0)
          reaper.gmem_write(XF + 21, sec.cue or 0)
          reaper.gmem_write(XF + 24, sec.phase or 0)
          xreq(l.id, 3, sec.s)
          loaded = loaded + 1
        end
      end
    end
  end
  job.msg = loaded .. " sezioni caricate" .. note
end

local function startJob(kind, slot)
  if job and not job.done then return end
  if slot < 1 or slot > NSLOTS then return end
  local fn = kind == "save" and saveJob or loadJob
  job = { kind = kind, slot = slot, p = 0, msg = "", err = "", done = false,
          co = coroutine.create(function() fn(slot) end) }
end

local function runJob(now)
  if not job or job.done then return end
  local t0 = reaper.time_precise()
  -- work for ~15 ms per run so REAPER stays responsive
  repeat
    local ok, err = coroutine.resume(job.co)
    if not ok then
      job.err = tostring(err); job.done = true; job.doneAt = now
    elseif coroutine.status(job.co) == "dead" then
      job.done = true; job.p = 1; job.doneAt = now
      refreshSlots()
    end
  until job.done or reaper.time_precise() - t0 > 0.015
end

---------------------------------------------------------------- scaletta (show)
-- A scaletta is the arrangement of a song written down in advance: at bar N this
-- section records, at bar M it plays, here a fade, there the drum machine stops.
-- The bridge keeps the clock and hands the time critical actions (rec/play/pause)
-- to the JSFX with the exact beat, so they land on the sample instead of on the
-- next run of this script.
--
-- Event types (shared with the web app):
--   1 rec   2 play   3 pause   4 silent rec          (one section)
--   5 fade in   6 fade out                            (looper, or section, val = bars*2)
--   7 filter   8 low   9 mid   10 high                (looper or section, val 0..200)
--   11 drum machine (val 0 = off, 1 = on, 2 = toggle)
--   12 tempo (val = bpm * 100)
--   13 wait: everything holds until the user says go
--   14 play all   15 stop all                         (one looper)
--
-- Wire format (ExtState "MyLooper/show"), no quotes or backslashes:
--   v1|name|bars|tempo|bar,type,looper,section,val;bar,type,...
local SHOW_SLOTS = 8
local show = nil              -- the scaletta in the editor / running
local showSlots = {}          -- what is on disk, for the UI
local run = { state = 0 }     -- 0 idle, 1 running, 2 waiting at a hold point

local function showDir() return memBase() .. "/scalette" end
local function showPath(slot) return showDir() .. "/show" .. slot .. ".txt" end

-- the web app sends it in a URL, so it may arrive percent encoded
local function urldecode(t)
  t = t:gsub("+", " ")
  return (t:gsub("%%(%x%x)", function(h) return string.char(tonumber(h, 16)) end))
end

local function parseShow(text)
  if not text or text == "" then return nil end
  if text:find("%%%x%x") or text:find("+", 1, true) then text = urldecode(text) end
  local ver, name, bars, tempo, evs = text:match("^(v%d+)|([^|]*)|([^|]*)|([^|]*)|(.*)$")
  if not ver then return nil end
  local sh = { name = name, bars = tonumber(bars) or 32, tempo = tonumber(tempo) or 0, events = {} }
  for ev in (evs .. ";"):gmatch("(.-);") do
    if ev ~= "" then
      local b, t, l, s, v = ev:match("^(-?%d+),(%d+),(-?%d+),(-?%d+),(-?%d+)$")
      if b then
        sh.events[#sh.events + 1] = { bar = tonumber(b), t = tonumber(t),
          l = tonumber(l), s = tonumber(s), v = tonumber(v) }
      end
    end
  end
  table.sort(sh.events, function(a, b)
    if a.bar ~= b.bar then return a.bar < b.bar end
    return a.t < b.t
  end)
  return sh
end

local function serializeShow(sh)
  if not sh then return "" end
  local parts = {}
  for _, e in ipairs(sh.events) do
    parts[#parts + 1] = string.format("%d,%d,%d,%d,%d", e.bar, e.t, e.l, e.s, e.v)
  end
  return string.format("v1|%s|%d|%d|%s", sh.name or "", sh.bars or 32, sh.tempo or 0,
    table.concat(parts, ";"))
end

local function refreshShowSlots()
  for i = 1, SHOW_SLOTS do
    local f = io.open(showPath(i), "r")
    if f then
      local sh = parseShow(f:read("*l") or "")
      f:close()
      showSlots[i] = sh and { slot = i, name = sh.name, bars = sh.bars, n = #sh.events } or { slot = i }
    else
      showSlots[i] = { slot = i }
    end
  end
end

local function saveShow(slot)
  if not show then return end
  reaper.RecursiveCreateDirectory(showDir(), 0)
  local f = io.open(showPath(slot), "w")
  if not f then return end
  f:write(serializeShow(show))
  f:close()
  refreshShowSlots()
end

local function loadShow(slot)
  local f = io.open(showPath(slot), "r")
  if not f then return end
  show = parseShow(f:read("*l") or "")
  f:close()
  run = { state = 0 }
  -- hand it back to the web app so the editor can show it
  reaper.SetExtState(EXT, "showdata", serializeShow(show), false)
end

local function deleteShow(slot)
  os.remove(showPath(slot))
  refreshShowSlots()
end

---------------------------------------------------------------- running it
local function barQN()
  local _, _, cml = reaper.TimeMap2_timeToBeats(0, reaper.GetPlayPosition())
  return (cml and cml > 0) and cml or 4
end

local function nowQN()
  local _, _, _, fullbeats = reaper.TimeMap2_timeToBeats(0, reaper.GetPlayPosition())
  return fullbeats or 0
end

local function nextBarQN()
  local pos = reaper.GetPlayPosition()
  local _, measures = reaper.TimeMap2_timeToBeats(0, pos)
  local t = reaper.TimeMap2_beatsToTime(0, 0, measures + 1)
  local _, _, _, fb = reaper.TimeMap2_timeToBeats(0, t)
  return fb or (nowQN() + barQN())
end

local function eventQN(e)
  return run.start + run.paused + (e.bar - 1) * run.bar
end

local function startShow()
  if not show then return end
  if not isPlaying() then reaper.OnPlayButton() end
  local bar = barQN()
  local now = nowQN()
  local start = nextBarQN()
  -- se la stanghetta e' proprio adesso non c'e' il tempo di prenotare: la successiva
  if start - now < bar * 0.25 then start = start + bar end
  run = { state = 1, start = start, paused = 0, bar = bar, fired = {}, booked = {},
          check = {}, nbook = 0, ndone = 0, nfall = 0 }
  if show.tempo and show.tempo > 0 then reaper.SetCurrentBPM(0, show.tempo, false) end
  -- uno stacco anche sulla drum? serve il gate sulle sue tracce
  for _, e in ipairs(show.events) do
    if e.t == 17 and e.l == 0 and math.floor(e.v / 4096) % 2 == 1 then ensureGate() break end
  end
end

local function stopShow()
  -- drop whatever was booked but has not happened yet
  if run.booked then
    for key in pairs(run.booked) do
      local id, s = key:match("^(%d+):(%d+)$")
      if id then push(tonumber(id), 28, tonumber(s)) end   -- act 0 = cancel
    end
  end
  -- e gli stacchi prenotati
  if run.nstk and run.nstk > 0 then
    for _, l in ipairs(loopers) do push(l.id, 31, 8) end
    gateClear()
  end
  run = { state = 0 }
end

local function continueShow()
  if run.state ~= 2 then return end
  run.paused = run.paused + (nextBarQN() - run.holdAt)
  run.state = 1
end

-- Rete di sicurezza: se la prenotazione nel JSFX non ha avuto effetto (JSFX
-- vecchio, id diverso, qualunque cosa), un giro dopo il bridge manda il comando
-- normale. Meglio un pelo in ritardo che niente.
-- tipo di evento della scaletta -> azione prenotata nel JSFX (comando 28)
local SCHED_ACT = { [1] = 3, [2] = 2, [3] = 1, [4] = 4 }

local function gsec(id, s, off) return reaper.gmem_read(id * 1024 + 16 + s * 12 + (off or 0)) end
local function looperVer(id) return reaper.gmem_read(id * 1024 + 11) end

local function sectionDone(e)
  local stt = gsec(e.l, e.s)
  if e.t == 1 or e.t == 4 then return stt >= 3 or gsec(e.l, e.s, 1) == 3 end
  if e.t == 2 then return stt >= 2 or gsec(e.l, e.s, 2) < 1 end
  if e.t == 3 then return stt <= 1 end
  return true
end

local function fireSectionNow(e)
  local stt = gsec(e.l, e.s)
  local pend = gsec(e.l, e.s, 1)
  local has = gsec(e.l, e.s, 2)
  -- "hold" e "rec silenziosa" sono interruttori: su una rec gia' in attesa la
  -- annullerebbero. Quindi solo se non c'e' gia' niente in arrivo.
  if e.t == 1 then
    if stt < 3 and pend ~= 3 then push(e.l, 2, e.s) end             -- hold = rec
  elseif e.t == 4 then
    if stt < 2 and pend ~= 3 then push(e.l, 18, e.s) end            -- rec silenziosa
  elseif e.t == 2 then
    if stt < 2 and has > 0 then push(e.l, 22, e.s) end -- play subito
  elseif e.t == 3 then
    if stt >= 2 then push(e.l, 22, e.s) end            -- pausa subito
  end
end

-- what a non time critical event does, fired when its bar arrives
local function fireEvent(e)
  local sec = e.s >= 0 and e.s or 0
  if e.t == 5 or e.t == 6 then
    local dir = (e.t == 5) and 1 or 0
    local half = math.max(1, math.min(128, e.v))
    if e.s >= 0 then push(e.l, 21, sec + 8 * (half * 2 + dir))
    else push(e.l, 20, half * 2 + dir) end
  elseif e.t >= 7 and e.t <= 10 then
    -- filter (7) / low mid high (8..10): v = value 0..200 + 256 * transition in quarter
    -- bars (0 = right away). The transition runs in the JSFX, locked to the beat.
    local val = e.v % 256
    local q = math.floor(e.v / 256)
    local kind = e.t - 7
    local ids = {}
    if e.l == 0 then for _, l in ipairs(loopers) do ids[#ids + 1] = l.id end else ids[1] = e.l end
    for _, id in ipairs(ids) do
      if q > 0 and looperVer(id) >= 12 then
        local dur4 = math.min(1023, math.floor(q / 4 * run.bar * 4 + 0.5))
        local beat4 = math.floor(eventQN(e) * 4 + 0.5)
        push(id, 32, (e.s >= 0 and sec or 8) + 16 * (kind + 4 * (val + 256 * (dur4 + 1024 * beat4))))
      elseif kind == 0 then
        if e.s >= 0 then push(id, 25, sec + 8 * val) else push(id, 23, val) end
      else
        local band = kind - 1
        if e.s >= 0 then push(id, 26, sec + 8 * (band + 3 * val)) else push(id, 24, band + 3 * val) end
      end
    end
  elseif e.t == 11 then
    if e.v == 2 or (e.v == 0) ~= (drums.mute == 1) then toggleDrums() end
  elseif e.t == 12 then
    if e.v > 0 then reaper.SetCurrentBPM(0, e.v / 100, false) end
  elseif e.t == 14 then
    push(e.l, 3, 0)
  elseif e.t == 15 then
    push(e.l, 4, 0)
  elseif e.t == 16 then
    sendPattern(e.v)
  elseif e.t == 18 then
    loadSound(e.v)
  end
end

-- stacco: v = pos + 64*dur (+ 4096 if the drum stops too), pos / dur in eighths.
-- Booked in the JSFX (and in the drum gate) for the exact beats.
local function bookStacco(e, at)
  local pos = e.v % 64
  local dur = math.floor(e.v / 64) % 64
  local withDrum = math.floor(e.v / 4096) % 2 == 1
  if dur < 1 then return end
  local a = at + pos * 0.5
  local b = a + dur * 0.5
  local arg = 16 * (dur * 2 + 1024 * math.floor(a * 4 + 0.5))
  if e.l == 0 then
    for _, l in ipairs(loopers) do push(l.id, 31, 8 + arg) end
    if withDrum then gateWindow(a, b) end
  elseif e.s < 0 then
    push(e.l, 31, 8 + arg)
  else
    push(e.l, 31, e.s + arg)
  end
  run.nstk = (run.nstk or 0) + 1
end

local function runShow()
  if run.state == 0 or not show then return end
  if not isPlaying() then return end        -- transport stopped: the show waits
  local now = nowQN()

  -- a hold point freezes everything until the user presses Continua
  if run.state == 2 then return end

  -- la prenotazione ha fatto effetto? se no, si manda il comando normale
  for k = #run.check, 1, -1 do
    local c = run.check[k]
    if now >= c.at then
      if not sectionDone(c.e) then
        fireSectionNow(c.e)
        run.nfall = (run.nfall or 0) + 1
      end
      table.remove(run.check, k)
    end
  end

  local lookahead = run.bar                 -- book the section actions one bar ahead
  local lastBar = 0
  for _, e in ipairs(show.events) do lastBar = math.max(lastBar, e.bar) end
  local holdBar = nil                       -- a wait still to come: nothing after it is booked
  for i, e in ipairs(show.events) do
    if holdBar and e.bar > holdBar then break end
    if not run.fired[i] then
      local at = eventQN(e)
      if e.t == 13 then                     -- wait
        if now >= at then
          run.fired[i] = true
          run.state = 2
          run.holdAt = at
          return
        end
        holdBar = e.bar
      elseif e.t >= 1 and e.t <= 4 and e.s >= 0 then
        local key = e.l .. ":" .. e.s
        local canBook = looperVer(e.l) >= 10
        if canBook and at <= now + lookahead and not run.booked[key] then
          -- the JSFX fires it on the exact beat: s + 8*act + 64*(beat*2).
          -- ATTENZIONE: i tipi della scaletta (1 rec, 2 play, 3 pausa, 4 rec in cuffia)
          -- NON sono le azioni del JSFX (1 pausa, 2 play, 3 rec, 4 rec in cuffia).
          push(e.l, 28, e.s + 8 * SCHED_ACT[e.t] + 64 * math.floor(at * 2 + 0.5))
          run.booked[key] = i
          run.nbook = (run.nbook or 0) + 1
        end
        if now >= at then
          run.fired[i] = true
          run.ndone = (run.ndone or 0) + 1
          if run.booked[key] == i then run.booked[key] = nil end
          if canBook then
            run.check[#run.check + 1] = { e = e, at = at + 0.75 }  -- ricontrolla fra poco
          else
            fireSectionNow(e)
            run.nfall = (run.nfall or 0) + 1
          end
        end
      elseif e.t == 17 then                 -- stacco: booked a bar ahead, the JSFX does the rest
        if at <= now + lookahead then
          run.fired[i] = true
          run.ndone = (run.ndone or 0) + 1
          bookStacco(e, at)
        end
      elseif e.t == 16 then                 -- pattern: sent a bit early if so set
        if now >= at - unoSetting("uno_lead", 0) * 0.5 then
          run.fired[i] = true
          fireEvent(e)
        end
      elseif now >= at then
        run.fired[i] = true
        fireEvent(e)
      end
    end
  end

  -- past the end: the scaletta is over
  if now >= run.start + run.paused + math.max(lastBar, show.bars or 0) * run.bar then
    run.state = 0
  end
end

local function showState()
  local slots = {}
  for i = 1, SHOW_SLOTS do
    local sl = showSlots[i] or { slot = i }
    slots[#slots + 1] = sl.name
      and string.format('{"slot":%d,"name":%s,"bars":%d,"n":%d}', i, jsonStr(sl.name), sl.bars or 0, sl.n or 0)
      or string.format('{"slot":%d}', i)
  end
  local bar, nextTxt = 0, ""
  if run.state > 0 and show then
    bar = math.floor((nowQN() - run.start - run.paused) / run.bar) + 1
    if bar < 1 then bar = 0 end
    for i, e in ipairs(show.events) do
      if not run.fired[i] then
        nextTxt = string.format("bar %d", e.bar)
        break
      end
    end
  end
  local ver = 99
  for _, l in ipairs(loopers) do ver = math.min(ver, looperVer(l.id)) end
  if ver == 99 then ver = 0 end
  return string.format('{"st":%d,"bar":%d,"name":%s,"bars":%d,"n":%d,"next":%s,' ..
    '"ver":%d,"book":%d,"done":%d,"fall":%d,"slots":[%s]}',
    run.state, bar, jsonStr(show and show.name or ""), show and show.bars or 0,
    show and #show.events or 0, jsonStr(nextTxt),
    ver, run.nbook or 0, run.ndone or 0, run.nfall or 0, table.concat(slots, ","))
end

local function handle(target, code, arg)
  if code == 100 then                        -- REAPER transport play/stop
    if isPlaying() then reaper.OnStopButton() else reaper.OnPlayButton() end
    return
  end
  if code == 200 then startJob("save", arg) return end
  if code == 201 then startJob("load", arg) return end
  if code == 202 then toggleDrums() return end       -- drum machine: mute / unmute at the bar
  if code == 203 then                                -- drum machine: resync (again = cancel)
    if sync.beat > 0 then sync.beat, sync.bar = 0, 0; reaper.gmem_write(GATE + 10, 0) else requestResync() end
    return
  end
  if code == 204 then                                -- resync settings: auto + 2*pattern bars
    reaper.SetExtState(EXT, "drum_sync_auto", tostring(arg % 2), true)
    reaper.SetExtState(EXT, "drum_patlen", tostring(math.max(1, math.floor(arg / 2))), true)
    return
  end
  -- scaletta
  if code == 210 then show = parseShow(reaper.GetExtState(EXT, "show")) return end
  if code == 211 then saveShow(arg) return end
  if code == 212 then loadShow(arg) return end
  if code == 213 then deleteShow(arg) return end
  if code == 214 then startShow() return end
  if code == 215 then stopShow() return end
  if code == 216 then continueShow() return end
  if code == 217 then sendPattern(arg) return end
  if code == 220 then saveSound() return end           -- synth: save the current sound
  if code == 221 then loadSound(arg) return end        -- synth: load sound id
  if code == 222 then deleteSound(arg) return end      -- synth: delete sound id      -- pattern now (to try it)
  if code == 218 then                                  -- pattern settings: ofs + 2*lead
    reaper.SetExtState(EXT, "uno_ofs", tostring(arg % 2), true)
    reaper.SetExtState(EXT, "uno_lead", tostring(math.floor(arg / 2)), true)
    return
  end
  if AUTO_TRANSPORT and (code == 1 or code == 2 or code == 3) and not isPlaying() then
    reaper.OnPlayButton()
  end
  for _, l in ipairs(loopers) do
    if target == 0 or target == l.id then push(l.id, code, arg) end
  end
end

-- cmd format: "<session>~<seq>.<target>.<code>.<arg>_<seq>.<target>.<code>.<arg>..."
-- The web app resends every command until it sees it acknowledged, so nothing is lost
-- if two commands arrive between two runs of this script.
local function readCommands()
  local s = reaper.GetExtState(EXT, "cmd")
  if s == "" then return end
  local sess, list = s:match("^(%w+)~(.*)$")
  if not sess then return end
  if sess ~= lastSess then lastSess = sess; lastSeq = 0 end
  for seq, tgt, code, arg in list:gmatch("(%d+)%.(%d+)%.(%d+)%.(%d+)") do
    seq = tonumber(seq)
    if seq > lastSeq then
      lastSeq = seq
      handle(tonumber(tgt), tonumber(code), tonumber(arg))
    end
  end
end

---------------------------------------------------------------- state
local function buildState(now)
  local out = {}
  for _, l in ipairs(loopers) do
    local gb = l.id * 1024
    local g  = function(o) return reaper.gmem_read(gb + o) end
    local hb = g(0)
    local seen = hbSeen[l.id]
    if not seen or seen.hb ~= hb then hbSeen[l.id] = { hb = hb, time = now } end
    local alive = (now - hbSeen[l.id].time) < 1.0

    local secs = {}
    for s = 0, 7 do
      local o = 16 + s * 12
      local f = 120 + s * 6      -- filter, low, mid, high, fade gain, fade kind
      secs[#secs + 1] = string.format(
        '{"st":%s,"pend":%s,"has":%s,"lvl":%s,"pos":%s,"beats":%s,"lenSec":%s,"vol":%s,"pan":%s,' ..
        '"mute":%s,"cue":%s,"fil":%s,"lo":%s,"mid":%s,"hi":%s,"fadeG":%s,"fade":%s}',
        num(g(o)), num(g(o + 1)), num(g(o + 2)), num(math.min(1, g(o + 3))),
        num(g(o + 4)), num(g(o + 5)), num(g(o + 6)), num(g(o + 7)), num(g(o + 8)), num(g(o + 9)),
        num(g(o + 10)),
        num(g(f)), num(g(f + 1)), num(g(f + 2)), num(g(f + 3)), num(g(f + 4)), num(g(f + 5)))
    end

    out[#out + 1] = string.format(
      '{"id":%d,"name":%s,"color":%s,"alive":%s,"ver":%s,"beats":%s,"mode":%s,"pos":%s,' ..
      '"running":%s,"tsNum":%s,"tsDenom":%s,"lenSec":%s,"mon":%s,"canDouble":%s,"maxSec":%s,' ..
      '"undoSec":%s,"undo":%s,"fadeG":%s,"fade":%s,"fadeK":%s,' ..
      '"fil":%s,"lo":%s,"mid":%s,"hi":%s,"sections":[%s]}',
      l.id, jsonStr(l.name), jsonStr(l.color), alive and "true" or "false", num(g(11)),
      num(g(1)), num(g(2)), num(g(3)), num(g(4)), num(g(5)), num(g(9)), num(g(6)), num(g(7)),
      num(g(8)), num(g(10)), num(g(12)), num(g(13)), num(g(14)), num(g(15)), num(g(116)),
      num(g(112)), num(g(113)), num(g(114)), num(g(115)),
      table.concat(secs, ","))
  end

  local mem = {}
  for _, sl in ipairs(slots) do
    mem[#mem + 1] = sl.saved
      and string.format('{"slot":%d,"saved":%s,"n":%d,"tempo":%s}', sl.slot, jsonStr(sl.saved), sl.n,
                        jsonStr(sl.tempo or ""))
      or string.format('{"slot":%d}', sl.slot)
  end
  local jobJson = "null"
  if job and (not job.done or now - (job.doneAt or now) < 5) then
    jobJson = string.format('{"kind":%s,"slot":%d,"p":%s,"done":%s,"msg":%s,"err":%s}',
      jsonStr(job.kind), job.slot, num(job.p), job.done and "true" or "false",
      jsonStr(job.msg or ""), jsonStr(job.err or ""))
  end

  local syncJson = string.format('{"bar":%d,"auto":%d,"len":%d,"x":%d,"n":%d,"miss":%d,"out":%d}',
    sync.bar, syncSetting("drum_sync_auto", 1), syncSetting("drum_patlen", 1), sync.xruns, sync.n, sync.miss,
    midiOutOk() and 1 or 0)
  local drumsJson = string.format('{"n":%d,"mute":%d,"pend":%d,"gate":%d,"sync":%s,' ..
    '"uno":{"dev":%d,"name":%s,"last":%d,"sent":%d,"err":%s,"ofs":%d,"lead":%d,"api":%d}}',
    #drums.tracks, drums.mute, drums.want, gateAlive(now) and 1 or 0, syncJson,
    uno.dev, jsonStr(uno.name), uno.last, uno.sent, jsonStr(uno.err),
    unoSetting("uno_ofs", 0), unoSetting("uno_lead", 0), reaper.SendMIDIMessageToHardware and 1 or 0)

  return string.format(
    '{"t":%d,"proto":%d,"sess":%s,"ack":%d,"playing":%s,"tempo":%s,"loopers":[%s],"mem":[%s],' ..
    '"job":%s,"drums":%s,"synth":%s,"show":%s}',
    tick, PROTO, jsonStr(lastSess), lastSeq, isPlaying() and "true" or "false",
    num(reaper.Master_GetTempo()), table.concat(out, ","), table.concat(mem, ","), jobJson, drumsJson, synthJson(),
    showState())
end

---------------------------------------------------------------- main loop
local lastErr = nil
local function step()
  local now = reaper.time_precise()
  tick = (tick + 1) % 1000000
  if now - lastScan > SCAN_EVERY then
    scan()
    scanDrums()
    scanUno()
    scanSynth()
    if not isPlaying() then prepareDrumSync(false) end   -- gate + MIDI out ready before playing
    if now - synth.listAt > 10 then refreshSynthList(now) end
    if not job or job.done then refreshSlots(); refreshShowSlots() end
    lastScan = now
  end
  readCommands()
  runDrums()
  runSync()
  runShow()
  runJob(now)
  reaper.SetExtState(EXT, "state", buildState(now), false)
end

local myToken = string.format("%.6f", reaper.time_precise())

local function main()
  -- another (newer) copy of the bridge took over: this one stops
  if reaper.GetExtState(EXT, "bridge_owner") ~= myToken then return end
  -- an error must never stop the bridge: log it once and keep going
  local ok, err = pcall(step)
  if not ok and err ~= lastErr then
    lastErr = err
    reaper.ShowConsoleMsg("MyLooper bridge: " .. tostring(err) .. "\n")
  end
  reaper.defer(main)
end

-- a previous copy of the bridge (e.g. an old version) is still running? stop it
reaper.SetExtState(EXT, "bridge_owner", myToken, false)

reaper.atexit(function()
  if reaper.GetExtState(EXT, "bridge_owner") == myToken then
    reaper.SetExtState(EXT, "state", "", false)
  end
end)

reaper.SetExtState(EXT, "cmd", "", false)
main()
