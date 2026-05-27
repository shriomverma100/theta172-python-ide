import puppeteer from 'puppeteer';

(async () => {
  console.log('🚀 Starting Collab E2E Test...');
  
  // Launch two separate browser contexts
  const browserTeacher = await puppeteer.launch({ headless: false, defaultViewport: null, args: ['--window-size=800,800', '--window-position=0,0'] });
  const browserStudent = await puppeteer.launch({ headless: false, defaultViewport: null, args: ['--window-size=800,800', '--window-position=800,0'] });

  const pageTeacher = await browserTeacher.newPage();
  const pageStudent = await browserStudent.newPage();

  const URL = 'http://localhost:5173'; // Web server port

  try {
    console.log('➔ Teacher navigating to IDE...');
    await pageTeacher.goto(URL, { waitUntil: 'networkidle2' });
    
    // --- TEACHER FLOW ---
    console.log('➔ Teacher opening Collab Panel...');
    await pageTeacher.click('#back-to-landing');
    
    // Wait for the panel to slide in and build DOM
    await pageTeacher.waitForSelector('#collab-role-share', { visible: true, timeout: 5000 });

    console.log('➔ Teacher selecting Share Role...');
    await pageTeacher.click('#collab-role-share');

    console.log('➔ Teacher configuring Share options...');
    await pageTeacher.waitForSelector('#share-name-input', { visible: true, timeout: 5000 });
    await pageTeacher.type('#share-name-input', 'Automated Teacher');
    
    console.log('➔ Teacher going live...');
    await pageTeacher.click('#btn-go-live');

    // Wait for connection and URL to generate
    await pageTeacher.waitForSelector('#collab-direct-url', { visible: true, timeout: 5000 });
    
    const directUrl = await pageTeacher.$eval('#collab-direct-url', el => el.value);
    console.log('✅ Teacher is live! Direct Connect URL:', directUrl);


    // --- STUDENT FLOW ---
    console.log('➔ Student navigating to IDE...');
    await pageStudent.goto(URL, { waitUntil: 'networkidle2' });

    console.log('➔ Student opening Collab Panel...');
    await pageStudent.click('#back-to-landing');
    
    await pageStudent.waitForSelector('#collab-role-view', { visible: true, timeout: 5000 });

    console.log('➔ Student selecting View Role...');
    await pageStudent.click('#collab-role-view');

    console.log('➔ Student inputting Direct Connect URL...');
    await pageStudent.waitForSelector('#direct-connect-input', { visible: true, timeout: 5000 });
    await pageStudent.type('#direct-connect-input', directUrl);
    await pageStudent.type('#viewer-name-input', 'Automated Student');

    console.log('➔ Student clicking Join...');
    await pageStudent.click('#btn-direct-connect');

    // Wait for student to connect
    await pageStudent.waitForFunction(() => {
      const status = document.getElementById('collab-status-text');
      return status && status.innerText.includes('Viewing');
    }, { timeout: 10000 });
    console.log('✅ Student successfully joined the room!');


    // --- SYNC VERIFICATION ---
    console.log('➔ Teacher typing in the editor...');
    
    // Click into Monaco Editor
    await pageTeacher.click('.monaco-editor');
    
    // Select all and delete
    await pageTeacher.keyboard.down('Control');
    await pageTeacher.keyboard.press('A');
    await pageTeacher.keyboard.up('Control');
    await pageTeacher.keyboard.press('Backspace');

    const testCode = 'print("Hello from the Automated Teacher Test!")';
    await pageTeacher.keyboard.type(testCode, { delay: 50 });

    // Wait for OT sync over WebSocket
    console.log('➔ Waiting 2 seconds for WebSockets to sync...');
    await new Promise(r => setTimeout(r, 2000));

    // Read value from Student's editor
    console.log('➔ Reading Student editor value...');
    const studentCode = await pageStudent.evaluate(() => {
      return window.monacoEditor.getValue();
    });

    if (studentCode.includes(testCode)) {
      console.log('\n🎉 SUCCESS: Code synchronized perfectly!');
      console.log('Teacher typed:', testCode);
      console.log('Student saw:', studentCode);
      process.exit(0);
    } else {
      console.error('\n❌ FAILURE: Code did not synchronize.');
      console.error('Expected:', testCode);
      console.error('Got:', studentCode);
      process.exit(1);
    }

  } catch (err) {
    console.error('\n❌ TEST ERROR:', err);
    await pageTeacher.screenshot({ path: 'teacher-error.png' });
    await pageStudent.screenshot({ path: 'student-error.png' });
    process.exit(1);
  } finally {
    console.log('➔ Closing browsers in 3 seconds...');
    await new Promise(r => setTimeout(r, 3000));
    await browserTeacher.close();
    await browserStudent.close();
  }
})();
