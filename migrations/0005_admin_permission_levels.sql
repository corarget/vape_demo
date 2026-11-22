UPDATE staff
SET permissions_json = (
  SELECT json_group_array(value)
  FROM (
    SELECT value FROM json_each(staff.permissions_json)
    UNION
    SELECT 'schedule.manage' WHERE EXISTS (
      SELECT 1 FROM json_each(staff.permissions_json) WHERE value='schedule'
    )
    UNION
    SELECT 'settings.manage' WHERE EXISTS (
      SELECT 1 FROM json_each(staff.permissions_json) WHERE value='settings'
    )
    UNION
    SELECT 'telegram.manage' WHERE EXISTS (
      SELECT 1 FROM json_each(staff.permissions_json) WHERE value='telegram'
    )
  )
)
WHERE role='manager' AND json_valid(permissions_json);

UPDATE staff_invites
SET permissions_json = (
  SELECT json_group_array(value)
  FROM (
    SELECT value FROM json_each(staff_invites.permissions_json)
    UNION
    SELECT 'schedule.manage' WHERE EXISTS (
      SELECT 1 FROM json_each(staff_invites.permissions_json) WHERE value='schedule'
    )
    UNION
    SELECT 'settings.manage' WHERE EXISTS (
      SELECT 1 FROM json_each(staff_invites.permissions_json) WHERE value='settings'
    )
    UNION
    SELECT 'telegram.manage' WHERE EXISTS (
      SELECT 1 FROM json_each(staff_invites.permissions_json) WHERE value='telegram'
    )
  )
)
WHERE role='manager' AND json_valid(permissions_json);
