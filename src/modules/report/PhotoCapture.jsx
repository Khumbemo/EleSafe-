import React, { useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';
import { storage } from '../../firebase';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';

export default function PhotoCapture({ photos, setPhotos, incidentId }) {
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const compressImage = (file) => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target.result;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          const MAX_WIDTH = 1200;
          const MAX_HEIGHT = 1200;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          canvas.toBlob((blob) => {
            resolve(new File([blob], file.name, {
              type: 'image/jpeg',
              lastModified: Date.now(),
            }));
          }, 'image/jpeg', 0.8);
        };
      };
    });
  };

  const handleCapture = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    if (photos.length + files.length > 3) {
      alert('You can only upload up to 3 photos');
      return;
    }

    setUploading(true);

    try {
      const newPhotos = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const compressedFile = await compressImage(file);

        // Use a local blob URL for preview before upload if offline,
        // or upload directly to Firebase if online
        const storageRef = ref(storage, `incidents/${incidentId}/photo_${Date.now()}_${i}.jpg`);
        const uploadTask = uploadBytesResumable(storageRef, compressedFile);

        const downloadUrl = await new Promise((resolve, reject) => {
          uploadTask.on('state_changed',
            (snapshot) => {
              const p = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
              setProgress(p);
            },
            (error) => reject(error),
            async () => {
              const url = await getDownloadURL(uploadTask.snapshot.ref);
              resolve(url);
            }
          );
        });

        newPhotos.push(downloadUrl);
      }

      setPhotos([...photos, ...newPhotos]);
    } catch (err) {
      console.error('Photo upload failed:', err);
      alert('Failed to upload photo. You might be offline. It will be saved locally.');
      // Fallback to local URL for offline mode
      const localUrls = files.map(f => URL.createObjectURL(f));
      setPhotos([...photos, ...localUrls]);
    } finally {
      setUploading(false);
      setProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removePhoto = (index) => {
    setPhotos(photos.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <label className="block text-sm font-medium text-neutral-700">Photos (Optional, max 3)</label>
        <span className="text-xs text-neutral-500">{photos.length}/3</span>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2">
        {photos.map((url, i) => (
          <div key={i} className="relative flex-shrink-0">
            <img src={url} alt={`Evidence ${i+1}`} className="w-24 h-24 object-cover rounded-lg border border-neutral-200" />
            <button
              type="button"
              onClick={() => removePhoto(i)}
              className="absolute -top-2 -right-2 bg-white rounded-full text-alert-red border border-neutral-200 shadow-sm p-1"
            >
              <X size={16} />
            </button>
          </div>
        ))}

        {photos.length < 3 && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className={`w-24 h-24 flex-shrink-0 flex flex-col items-center justify-center border-2 border-dashed border-neutral-300 rounded-lg text-neutral-500 bg-neutral-50 hover:bg-neutral-100 ${uploading ? 'opacity-50' : ''}`}
          >
            <Camera size={24} className="mb-1" />
            <span className="text-xs font-medium">{uploading ? `${Math.round(progress)}%` : 'Add Photo'}</span>
          </button>
        )}
      </div>

      <input
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        ref={fileInputRef}
        onChange={handleCapture}
      />
    </div>
  );
}
