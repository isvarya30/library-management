$(document).ready(function() {
  // Registration form
  $("#registrationForm").on("submit", function(e) {
    e.preventDefault();

    const data = {
      memberId: "",
      memberFirstName: $("#firstName").val(),
      memberMiddleName: "",
      memberLastName: $("#lastName").val(),
      memberEmail: $("#email").val(),
      memberAddressLine1: $("#address1").val(),
      memberAddressLine2: $("#address2").val(),
      memberMobileNumber: $("#phone").val(),
      memberWorkStatus: $("#workStatus").val(), // e.g. STUD, EMP
      membershipPeriod: $("#membershipPeriod").val(), // e.g. 3
      memberDob: $("#dob").val()
    };

    $.ajax({
      url: "https://dev-api.humhealth.com/LibraryManagementAPI/members/save",
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify(data),
      success: function(result) {
        $("#responseMessage").text(result.message || "Registration successful!");
      },
      error: function(xhr, status, error) {
        $("#responseMessage").text("Error: " + xhr.responseText);
      }
    });
  });

  // Load members list
  $("#loadMembers").on("click", function() {
    const requestData = {
      start: 0,
      length: 10,
      searchValue: "",
      order: {
        sortType: "asc",
        sortColumn: "memberFirstName"
      },
      filter: {
        memberWorkStatus: "",
        membershipStatus: "ACTIVE"
      }
    };

    $.ajax({
      url: "https://dev-api.humhealth.com/LibraryManagementAPI/members/list",
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify(requestData),
      success: function(result) {
        if (result.status === "Success") {
          let html = "<table border='1'><tr><th>Name</th><th>Email</th><th>Status</th></tr>";
          result.data.forEach(member => {
            html += `<tr>
              <td>${member.memberFirstName} ${member.memberLastName}</td>
              <td>${member.memberEmail}</td>
              <td>${member.membershipStatusDescription}</td>
            </tr>`;
          });
          html += "</table>";
          $("#membersContainer").html(html);
        } else {
          $("#membersContainer").text("No members found.");
        }
      },
      error: function(xhr, status, error) {
        $("#membersContainer").text("Error: " + xhr.responseText);
      }
    });
  });
});
