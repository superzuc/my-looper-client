--[[
  MyLooper - test della UNO Drum (cambio pattern)
  ------------------------------------------------
  Lancialo da REAPER (Actions > Show action list > New action > Load ReaScript, oppure
  dal menu Actions se l'hai gia' caricato). Con la UNO collegata e accesa.

  Cosa fa, un passo ogni mezzo secondo:
    1. trova la UNO tra le uscite e gli ingressi MIDI di REAPER
    2. le chiede la versione del firmware   (SysEx F0 00 21 1A 02 02 12 F7)
    3. le chiede kit e pattern attuali       (SysEx ... 14 F7)
    4. le manda il cambio pattern            (SysEx ... 35 00 <n> F7)
    5. le richiede kit e pattern, per vedere se e' cambiato
  e registra le risposte della UNO. Se REAPER non ha SendMIDIMessageToHardware (la 6.67 non
  ce l'ha) i messaggi passano dal gate sulla prima traccia drum, come fa il looper. Il risultato va nella console di REAPER e nel file
  Scripts/MyLooper/uno_test_log.txt (cosi' si puo' leggere anche da fuori).
]]

local log = {}
local function say(s)
  log[#log + 1] = s
  reaper.ShowConsoleMsg(s .. "\n")
end
local function hex(s)
  local t = {}
  for i = 1, #s do t[#t + 1] = string.format("%02X", s:byte(i)) end
  return table.concat(t, " ")
end
local function save()
  local f = io.open(reaper.GetResourcePath() .. "/Scripts/MyLooper/uno_test_log.txt", "w")
  if f then f:write(table.concat(log, "\n") .. "\n"); f:close() end
end

reaper.ClearConsole()
say("MyLooper - test UNO Drum  (" .. os.date("%Y-%m-%d %H:%M:%S") .. ")")
say("REAPER " .. reaper.GetAppVersion())
say("SendMIDIMessageToHardware: " .. (reaper.SendMIDIMessageToHardware and "si'" or "NO"))
say("MIDI_GetRecentInputEvent: " .. (reaper.MIDI_GetRecentInputEvent and "si'" or "NO"))

-- 1. dispositivi
local outDev, inDev = -1, -1
for i = 0, reaper.GetNumMIDIOutputs() - 1 do
  local ok, name = reaper.GetMIDIOutputName(i, "")
  if ok then
    say(string.format("  uscita %d: %s", i, name))
    if name:lower():find("uno", 1, true) and outDev < 0 then outDev = i end
  end
end
for i = 0, reaper.GetNumMIDIInputs() - 1 do
  local ok, name = reaper.GetMIDIInputName(i, "")
  if ok then
    say(string.format("  ingresso %d: %s", i, name))
    if name:lower():find("uno", 1, true) and inDev < 0 then inDev = i end
  end
end
say("UNO: uscita " .. outDev .. ", ingresso " .. inDev)
if outDev < 0 then
  say("STOP: la UNO non e' tra le uscite MIDI")
  save()
  return
end

-- la strada del gate: prima traccia drum, gate su quella traccia, uscita MIDI verso la UNO
reaper.gmem_attach("MyLooper")
local GATE = 64
local drumTr = nil
for t = 0, reaper.CountTracks(0) - 1 do
  local tr = reaper.GetTrack(0, t)
  local _, name = reaper.GetSetMediaTrackInfo_String(tr, "P_NAME", "", false)
  if name:lower():find("drum", 1, true) then drumTr = tr; say("traccia drum: " .. name); break end
end
local useGate = not reaper.SendMIDIMessageToHardware
if useGate then
  if not drumTr then say("STOP: nessuna traccia con 'drum' nel nome"); save(); return end
  local hasGate = false
  for f = 0, reaper.TrackFX_GetCount(drumTr) - 1 do
    local _, n = reaper.TrackFX_GetFXName(drumTr, f, "")
    if n:lower():find("mylooper gate", 1, true) or n:lower():find("mylooper_gate", 1, true) then
      hasGate = true
      say("gate trovato: " .. n .. (reaper.TrackFX_GetEnabled(drumTr, f) and "" or "  (DISATTIVATO!)"))
    end
  end
  if not hasGate then say("STOP: sulla traccia drum non c'e' MyLooper_gate.jsfx"); save(); return end
  local out = reaper.GetMediaTrackInfo_Value(drumTr, "I_MIDIHWOUT")
  say("uscita MIDI della traccia drum: " .. out .. " (serve " .. (outDev * 32) .. ")")
  if out ~= outDev * 32 then
    reaper.SetMediaTrackInfo_Value(drumTr, "I_MIDIHWOUT", outDev * 32)
    say("  -> impostata verso la UNO")
  end
end

local ok, vals = reaper.GetUserInputs("Test UNO Drum", 2,
  "Pattern a cui saltare (1-100),Kit per la prova del Program Change (1-100)", "2,2")
if not ok then return end
local pat, kit = vals:match("^([^,]*),([^,]*)$")
pat = math.max(1, math.min(100, tonumber(pat) or 2))
kit = math.max(1, math.min(100, tonumber(kit) or 2))

local HDR = string.char(0xF0, 0x00, 0x21, 0x1A, 0x02, 0x02)
local sxSeq = math.floor(reaper.gmem_read(GATE + 20))
local lastSent = nil
local function sendRaw(label, msg)
  if useGate then
    sxSeq = sxSeq + 1
    reaper.gmem_write(GATE + 22, #msg)
    for k = 1, #msg do reaper.gmem_write(GATE + 22 + k, msg:byte(k)) end
    reaper.gmem_write(GATE + 21, 0)
    reaper.gmem_write(GATE + 20, sxSeq)
    lastSent = sxSeq
    say("-> " .. label .. " (dal gate):  " .. hex(msg))
  else
    reaper.SendMIDIMessageToHardware(outDev, msg)
    say("-> " .. label .. ":  " .. hex(msg))
  end
end
local function send(label, body)
  local msg = HDR .. body .. string.char(0xF7)
  if useGate then
    sxSeq = sxSeq + 1
    reaper.gmem_write(GATE + 22, #msg)
    for k = 1, #msg do reaper.gmem_write(GATE + 22 + k, msg:byte(k)) end
    reaper.gmem_write(GATE + 21, 0)
    reaper.gmem_write(GATE + 20, sxSeq)
    lastSent = sxSeq
    say("-> " .. label .. " (dal gate):  " .. hex(msg))
  else
    reaper.SendMIDIMessageToHardware(outDev, msg)
    say("-> " .. label .. ":  " .. hex(msg))
  end
end
local function gateCheck()
  if useGate and lastSent then
    local ack = reaper.gmem_read(GATE + 39)
    if ack ~= lastSent then say("   ATTENZIONE: il gate non l'ha mandato (gate fermo? traccia senza audio?)") end
  end
end

-- risposte: tutto quello che arriva in SysEx dalla UNO
local lastSeq = 0
if reaper.MIDI_GetRecentInputEvent then lastSeq = reaper.MIDI_GetRecentInputEvent(0) end
local function collect()
  gateCheck()
  if not reaper.MIDI_GetRecentInputEvent then return end
  local got, newest = {}, nil
  local idx = 0
  while true do
    local seq, buf, _, dev = reaper.MIDI_GetRecentInputEvent(idx)
    if not seq or seq == 0 or seq == lastSeq then break end
    if idx == 0 then newest = seq end
    local b1 = buf and buf:byte(1) or 0
    if b1 ~= 0xF8 and b1 ~= 0xFE and b1 ~= 0xFA and b1 ~= 0xFC and b1 ~= 0xFB then
      table.insert(got, 1, string.format("<- dall'ingresso %d:  %s", (dev or 0) & 0xFFFF, hex(buf)))
    end
    idx = idx + 1
    if idx > 200 then break end
  end
  if newest then lastSeq = newest end
  if #got == 0 then say("   (niente in arrivo)") end
  for _, g in ipairs(got) do say("  " .. g) end
end

local steps = {
  function()
    say("")
    say("PROVA 0: Program Change DIRETTO all'uscita UNO (StuffMIDIMessage), su tutti i 16 canali")
    for ch = 0, 15 do reaper.StuffMIDIMessage(16 + outDev, 0xC0 + ch, kit - 1, 0) end
    say("-> kit " .. kit .. " (diretto, canali 1-16)")
  end,
  function()
    collect()
    say("   (guarda la UNO: e' cambiato il kit?)")
  end,
  function() end,
  function() end,
  function()
    say("")
    say("PROVA 1: Program Change dal gate (canale 10)")
    sendRaw("kit " .. kit, string.char(0xC9, kit - 1))
  end,
  function()
    collect()
    say("PROVA 2: tocca qualche pad della UNO adesso (3 secondi)")
  end,
  function() end,
  function() end,
  function() end,
  function() end,
  function()
    collect()
    say("")
    say("PROVA 3: SysEx")
    send("versione firmware", string.char(0x12))
  end,
  function() collect(); send("kit e pattern attuali", string.char(0x14)) end,
  function() collect(); send("vai al pattern " .. pat .. " (byte " .. pat .. ")", string.char(0x35, 0x00, pat)) end,
  function() collect(); send("kit e pattern dopo il cambio", string.char(0x14)) end,
  function()
    collect()
    say("")
    say("Fatto. Dimmi: 1) il KIT e' cambiato?  2) il PATTERN e' cambiato?")
    save()
  end,
}
local i, t0 = 1, reaper.time_precise()
local function run()
  if reaper.time_precise() - t0 >= 0.5 then
    steps[i]()
    i = i + 1
    t0 = reaper.time_precise()
  end
  if i <= #steps then reaper.defer(run) end
end
run()
