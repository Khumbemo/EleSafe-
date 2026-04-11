import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../../firebase';
import { doc, getDoc } from 'firebase/firestore';

export default function OTPVerify() {
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(60);
  const navigate = useNavigate();
  const inputRefs = useRef([]);

  useEffect(() => {
    if (!window.confirmationResult) {
      navigate('/login');
    }

    inputRefs.current[0]?.focus();

    const timer = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => clearInterval(timer);
  }, [navigate]);

  const handleChange = (index, value) => {
    if (isNaN(value)) return;

    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);

    // Auto focus next
    if (value !== '' && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const verifyOtp = async (e) => {
    e?.preventDefault();
    const otpString = otp.join('');
    if (otpString.length !== 6) {
      setError('Please enter complete 6-digit OTP');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await window.confirmationResult.confirm(otpString);
      const user = result.user;

      // Check if user exists in Firestore
      const userDoc = await getDoc(doc(db, 'users', user.uid));

      if (userDoc.exists()) {
        navigate('/');
      } else {
        navigate('/register');
      }
    } catch (err) {
      setError('Invalid OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-xl shadow-lg p-8">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-display font-bold text-neutral-900 mb-2">Verify OTP</h2>
          <p className="text-neutral-600">Enter the 6-digit code sent to your phone</p>
        </div>

        <div className="flex justify-between mb-8 gap-2">
          {otp.map((digit, index) => (
            <input
              key={index}
              ref={el => inputRefs.current[index] = el}
              type="text"
              maxLength="1"
              value={digit}
              onChange={(e) => handleChange(index, e.target.value)}
              onKeyDown={(e) => handleKeyDown(index, e)}
              className="w-12 h-14 text-center text-2xl font-bold border-2 border-neutral-300 rounded-lg focus:border-forest-500 focus:ring-forest-500 bg-neutral-50"
            />
          ))}
        </div>

        {error && <p className="text-center text-alert-red text-sm mb-4">{error}</p>}

        <button
          onClick={verifyOtp}
          disabled={loading || otp.join('').length !== 6}
          className={`w-full py-4 rounded-lg shadow-sm text-lg font-medium text-white bg-forest-600 hover:bg-forest-700 min-h-[48px] ${
            (loading || otp.join('').length !== 6) ? 'opacity-50 cursor-not-allowed' : ''
          }`}
        >
          {loading ? 'Verifying...' : 'Verify'}
        </button>

        <div className="mt-6 text-center text-sm text-neutral-600">
          {countdown > 0 ? (
            <p>Resend code in {countdown}s</p>
          ) : (
            <button
              onClick={() => navigate('/login')}
              className="text-forest-600 font-medium hover:underline p-2 min-h-[48px]"
            >
              Resend OTP
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
