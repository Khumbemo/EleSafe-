import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, Play, Trash2 } from 'lucide-react';
import { storage } from '../../firebase';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';

export default function VoiceNote({ voiceUrl, setVoiceUrl, incidentId }) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [uploading, setUploading] = useState(false);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await uploadAudio(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      timerRef.current = setInterval(() => {
        setRecordingTime(prev => {
          if (prev >= 59) {
            stopRecording();
            return 60;
          }
          return prev + 1;
        });
      }, 1000);

    } catch (err) {
      console.error('Microphone access error:', err);
      alert('Could not access microphone. Please check permissions.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      clearInterval(timerRef.current);
    }
  };

  const uploadAudio = async (blob) => {
    setUploading(true);
    try {
      const storageRef = ref(storage, `incidents/${incidentId}/voice_${Date.now()}.webm`);
      const uploadTask = uploadBytesResumable(storageRef, blob);

      const downloadUrl = await new Promise((resolve, reject) => {
        uploadTask.on('state_changed',
          null,
          (error) => reject(error),
          async () => {
            const url = await getDownloadURL(uploadTask.snapshot.ref);
            resolve(url);
          }
        );
      });

      setVoiceUrl(downloadUrl);
    } catch (err) {
      console.error('Audio upload failed:', err);
      alert('Failed to upload audio. Will save locally for now.');
      setVoiceUrl(URL.createObjectURL(blob));
    } finally {
      setUploading(false);
    }
  };

  const deleteRecording = () => {
    setVoiceUrl(null);
    setRecordingTime(0);
  };

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-neutral-700">Voice Note (Optional, max 60s)</label>

      {!voiceUrl ? (
        <div className="flex items-center gap-4">
          {!isRecording ? (
            <button
              type="button"
              onClick={startRecording}
              className="flex items-center justify-center w-12 h-12 rounded-full bg-forest-100 text-forest-600 hover:bg-forest-200"
            >
              <Mic size={24} />
            </button>
          ) : (
            <button
              type="button"
              onClick={stopRecording}
              className="flex items-center justify-center w-12 h-12 rounded-full bg-alert-red text-white animate-pulse"
            >
              <Square size={20} fill="currentColor" />
            </button>
          )}

          <div className="flex-1">
            {isRecording ? (
              <div className="text-alert-red font-mono font-medium">Recording: {formatTime(recordingTime)} / 1:00</div>
            ) : uploading ? (
              <div className="text-neutral-500 text-sm">Uploading audio...</div>
            ) : (
              <div className="text-neutral-500 text-sm">Tap microphone to record</div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 bg-neutral-100 p-3 rounded-lg border border-neutral-200">
          <audio controls src={voiceUrl} className="flex-1 h-10" />
          <button
            type="button"
            onClick={deleteRecording}
            className="p-2 text-alert-red hover:bg-red-50 rounded-full"
          >
            <Trash2 size={20} />
          </button>
        </div>
      )}
    </div>
  );
}
