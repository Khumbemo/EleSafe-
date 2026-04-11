import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../../firebase';
import { RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth';

export default function LoginScreen() {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [language, setLanguage] = useState('en');
  const navigate = useNavigate();

  const setupRecaptcha = () => {
    if (!window.recaptchaVerifier) {
      window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
        size: 'invisible'
      });
    }
  };

  const handleSendOtp = async (e) => {
    e.preventDefault();
    setError('');

    if (phoneNumber.length !== 10) {
      setError(language === 'en' ? 'Enter a valid 10-digit number' : 'Sahi 10-digit number dibi');
      return;
    }

    setLoading(true);
    try {
      setupRecaptcha();
      const formatPhone = `+91${phoneNumber}`;
      const confirmationResult = await signInWithPhoneNumber(auth, formatPhone, window.recaptchaVerifier);
      window.confirmationResult = confirmationResult;
      navigate('/verify-otp');
    } catch (err) {
      setError(err.message);
      if (window.recaptchaVerifier) {
        window.recaptchaVerifier.clear();
        window.recaptchaVerifier = null;
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-xl shadow-lg p-8">

        <div className="flex justify-end mb-6">
          <button
            onClick={() => setLanguage(l => l === 'en' ? 'nag' : 'en')}
            className="text-sm font-medium text-forest-600 bg-forest-50 px-3 py-1 rounded-full"
          >
            {language === 'en' ? 'English' : 'Nagamese'}
          </button>
        </div>

        <div className="text-center mb-8">
          <h1 className="text-3xl font-display font-bold text-forest-700 mb-2">HatiAlert</h1>
          <p className="text-neutral-600">
            {language === 'en' ? 'Login to your account' : 'Apni laga account te ghusibi'}
          </p>
        </div>

        <form onSubmit={handleSendOtp} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">
              {language === 'en' ? 'Phone Number' : 'Phone Number'}
            </label>
            <div className="flex">
              <span className="inline-flex items-center px-4 rounded-l-lg border border-r-0 border-neutral-300 bg-neutral-50 text-neutral-500 font-medium">
                +91
              </span>
              <input
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, '').slice(0,10))}
                className="flex-1 block w-full min-w-0 rounded-none rounded-r-lg border border-neutral-300 px-4 py-3 text-lg focus:border-forest-500 focus:ring-forest-500"
                placeholder="00000 00000"
                required
              />
            </div>
            {error && <p className="mt-2 text-sm text-alert-red">{error}</p>}
          </div>

          <div id="recaptcha-container"></div>

          <button
            type="submit"
            disabled={loading}
            className={`w-full flex justify-center py-4 px-4 border border-transparent rounded-lg shadow-sm text-lg font-medium text-white bg-forest-600 hover:bg-forest-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest-500 min-h-[48px] ${loading ? 'opacity-70' : ''}`}
          >
            {loading ? 'Sending...' : (language === 'en' ? 'Get OTP' : 'OTP Magibi')}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            onClick={() => navigate('/register')}
            className="text-forest-600 font-medium hover:underline p-2"
          >
            {language === 'en' ? 'New user? Register here' : 'Natun manu? Yate register koribi'}
          </button>
        </div>
      </div>
    </div>
  );
}
