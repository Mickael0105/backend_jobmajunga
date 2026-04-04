import axios from 'axios';

async function test() {
  try {
    const email = `test${Date.now()}@test.com`;
    // 1. Register recruiter
    const regResp = await axios.post('http://localhost:3000/v1/auth/register', {
      email,
      password: 'password123',
      role: 'recruiter',
      consent: true,
      recruiterProfile: { companyName: "Test Company" }
    });
    const token = regResp.data.accessToken;

    // 2. Create job with null values
    const jobData = {
      title: "Test Job",
      description: "Test Description",
      contractType: "CDI",
      location: null,
      salaryMin: null,
      salaryMax: null,
      category: null,
      skills: null,
      expiresAt: null
    };

    const resp = await axios.post('http://localhost:3000/v1/jobs', jobData, {
      headers: { Authorization: `Bearer ${token}` }
    });

    console.log("Success:", resp.data);

  } catch (error) {
    if (error.response) {
      console.log("Response Error status:", error.response.status);
      console.log("Response Error data:", error.response.data);
    } else {
      console.log("Error:", error.message);
    }
  }
}

test();
