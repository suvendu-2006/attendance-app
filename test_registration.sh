#!/bin/bash
export FRONTEND_URL="http://localhost:5173"
export BACKEND_URL="http://localhost:5001"

echo "Running registration tests..."
curl -s -X POST $BACKEND_URL/api/auth/teacher/login -H "Content-Type: application/json" -H "x-requested-with: api" -d '{"phone_number":"demo-teacher","password":"demo"}' -c cookies.txt > /dev/null

echo "1. Generating invite code"
INVITE_RESP=$(curl -s -X POST $BACKEND_URL/api/auth/admin/generate-invite -H "x-requested-with: api" -b cookies.txt)
INVITE_CODE=$(echo $INVITE_RESP | grep -o '"code":"[^"]*' | cut -d'"' -f4)
echo "Invite code: $INVITE_CODE"

echo "2. Register teacher"
curl -s -X POST $BACKEND_URL/api/auth/teacher/register -H "Content-Type: application/json" -H "x-requested-with: api" -d "{\"name\":\"Test Teacher\",\"phone_number\":\"1112223334\",\"password\":\"password\",\"invite_code\":\"$INVITE_CODE\"}"

echo -e "\n3. Re-use invite code (should fail)"
curl -s -X POST $BACKEND_URL/api/auth/teacher/register -H "Content-Type: application/json" -H "x-requested-with: api" -d "{\"name\":\"Test Teacher 2\",\"phone_number\":\"1112223335\",\"password\":\"password\",\"invite_code\":\"$INVITE_CODE\"}"

echo -e "\n4. Import students (CSV)"
cat << 'CSV' > test_students.csv
name,roll_number,phone_number
Test1,TST001,1234567890
Test2,TST002,1234567891
CSV
IMPORT_RESP=$(curl -s -X POST $BACKEND_URL/api/auth/admin/import-students -H "x-requested-with: api" -b cookies.txt -F "file=@test_students.csv")
echo $IMPORT_RESP

TEMP_PASS=$(echo $IMPORT_RESP | grep -o '"tempPassword":"[^"]*' | head -n 1 | cut -d'"' -f4)
echo -e "\nTemp pass: $TEMP_PASS"

echo "5. Wrong temp password (should fail)"
curl -s -X POST $BACKEND_URL/api/auth/student/activate -H "Content-Type: application/json" -H "x-requested-with: api" -d "{\"roll_number\":\"TST001\",\"temp_password\":\"wrong\",\"new_password\":\"newpass\"}"

echo -e "\n6. Activate student"
curl -s -X POST $BACKEND_URL/api/auth/student/activate -H "Content-Type: application/json" -H "x-requested-with: api" -d "{\"roll_number\":\"TST001\",\"temp_password\":\"$TEMP_PASS\",\"new_password\":\"newpass\"}"

echo -e "\nDone"
